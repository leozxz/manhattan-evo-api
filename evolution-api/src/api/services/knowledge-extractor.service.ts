import { configService } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { PrismaRepository } from '@api/repository/repository.service';
import { CacheService } from './cache.service';

interface ExtractedEntity {
  category: string;
  label: string;
  value: string;
  confidence: number;
}

interface ExtractedRelationship {
  fromLabel: string;
  toLabel: string;
  type: string;
  description?: string;
}

interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  summary: string;
}

const EXTRACTION_PROMPT = `Você é um analisador de informações de clientes. Analise as mensagens do chat e extraia informações importantes sobre o cliente.

CATEGORIAS DE ENTIDADES para extrair:
- PESSOA: nomes de familiares, amigos, colegas (label: nome, value: relação com o contato)
- FAMILIA: informações familiares (label: tipo como "estado_civil", "filhos", "cônjuge", value: detalhe)
- FINANCEIRO: renda, dívidas, investimentos, profissão (label: tipo, value: detalhe)
- SAUDE: condições de saúde, medicamentos, planos (label: tipo, value: detalhe)
- MORADIA: endereço, tipo de imóvel, bairro (label: tipo, value: detalhe)
- TRABALHO: empresa, cargo, área de atuação (label: tipo, value: detalhe)
- EDUCACAO: formação, cursos, instituições (label: tipo, value: detalhe)
- INTERESSE: hobbies, preferências, gostos (label: tipo, value: detalhe)
- EVENTO: datas importantes, aniversários, compromissos (label: tipo, value: detalhe)
- SENTIMENTO: humor atual, satisfação, reclamações (label: tipo, value: detalhe)

REGRAS:
1. Extraia APENAS informações explicitamente mencionadas nas mensagens.
2. NÃO invente ou infira informações que não estejam claras.
3. Atribua um nível de confiança (0.0 a 1.0) para cada entidade.
4. Identifique relacionamentos entre entidades quando possível.
5. Gere um resumo breve do perfil atualizado do cliente.

CONTEXTO EXISTENTE DO CLIENTE:
{existingContext}

MENSAGENS RECENTES:
{messages}

Responda SOMENTE com JSON válido no seguinte formato:
{
  "entities": [
    {"category": "CATEGORIA", "label": "rotulo", "value": "valor extraído", "confidence": 0.9}
  ],
  "relationships": [
    {"fromLabel": "rotulo_entidade_1", "toLabel": "rotulo_entidade_2", "type": "TIPO_RELACAO", "description": "descrição"}
  ],
  "summary": "Resumo atualizado do perfil do cliente"
}`;

export class KnowledgeExtractorService {
  private readonly logger = new Logger('KnowledgeExtractorService');
  private messageBuffers: Map<string, { messages: string[]; timer: NodeJS.Timeout | null }> = new Map();
  private readonly DEBOUNCE_MS = 30_000; // 30 seconds
  private readonly MIN_MESSAGES = 3;
  private readonly MAX_MESSAGES = 20;

  constructor(
    private readonly prismaRepository: PrismaRepository,
    private readonly cache: CacheService,
  ) {
    this.logger.info('KnowledgeExtractorService initialized');
  }

  private getBufferKey(instanceId: string, remoteJid: string): string {
    return `${instanceId}:${remoteJid}`;
  }

  public async onMessage(data: {
    instanceId: string;
    remoteJid: string;
    pushName?: string;
    messageText: string;
    fromMe: boolean;
  }) {
    // Only extract from contact messages (not bot/self messages)
    if (data.fromMe) return;

    // Skip groups and broadcast
    if (data.remoteJid.includes('@g.us') || data.remoteJid === 'status@broadcast') return;

    // Skip non-text messages
    if (!data.messageText || data.messageText.trim().length === 0) return;

    const bufferKey = this.getBufferKey(data.instanceId, data.remoteJid);

    let buffer = this.messageBuffers.get(bufferKey);
    if (!buffer) {
      buffer = { messages: [], timer: null };
      this.messageBuffers.set(bufferKey, buffer);
    }

    buffer.messages.push(`[${data.pushName || 'Cliente'}]: ${data.messageText}`);

    // Clear existing timer
    if (buffer.timer) {
      clearTimeout(buffer.timer);
    }

    // If we hit max messages, extract immediately
    if (buffer.messages.length >= this.MAX_MESSAGES) {
      await this.extractAndSave(data.instanceId, data.remoteJid, data.pushName);
      return;
    }

    // Set debounce timer — only extract if we have minimum messages
    buffer.timer = setTimeout(async () => {
      if (buffer && buffer.messages.length >= this.MIN_MESSAGES) {
        await this.extractAndSave(data.instanceId, data.remoteJid, data.pushName);
      }
    }, this.DEBOUNCE_MS);
  }

  private async extractAndSave(instanceId: string, remoteJid: string, pushName?: string) {
    const bufferKey = this.getBufferKey(instanceId, remoteJid);
    const buffer = this.messageBuffers.get(bufferKey);
    if (!buffer || buffer.messages.length === 0) return;

    const messages = [...buffer.messages];
    buffer.messages = [];
    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }

    try {
      // Get existing knowledge for context
      const existing = await this.prismaRepository.contactKnowledge.findUnique({
        where: { remoteJid_instanceId: { remoteJid, instanceId } },
        include: { entities: true, relationships: true },
      });

      const existingContext = existing
        ? `Resumo: ${existing.summary || 'Nenhum'}\nEntidades conhecidas: ${existing.entities.map((e) => `${e.category}:${e.label}=${e.value}`).join(', ') || 'Nenhuma'}`
        : 'Nenhuma informação prévia sobre este cliente.';

      const prompt = EXTRACTION_PROMPT
        .replace('{existingContext}', existingContext)
        .replace('{messages}', messages.join('\n'));

      const extraction = await this.callLLM(prompt, instanceId);
      if (!extraction) return;

      await this.saveExtraction(instanceId, remoteJid, pushName, extraction, existing?.id);

      // Cache the updated profile
      const cacheKey = `knowledge:${instanceId}:${remoteJid}`;
      await this.cache.set(cacheKey, JSON.stringify(extraction.summary), 3600);

      this.logger.info(`Knowledge extracted for ${remoteJid} in instance ${instanceId}: ${extraction.entities.length} entities`);
    } catch (error) {
      this.logger.error(['Error extracting knowledge', error?.message, error?.stack]);
    }
  }

  private async callLLM(prompt: string, instanceId: string): Promise<ExtractionResult | null> {
    try {
      const apiKey = process.env.OPENAI_API_KEY;

      if (!apiKey) {
        this.logger.warn('OPENAI_API_KEY not set, skipping knowledge extraction');
        return null;
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Você é um extrator de informações de clientes. Responda APENAS com JSON válido.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        this.logger.error(`OpenAI API error: ${response.status} ${response.statusText}`);
        return null;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) return null;

      const parsed = JSON.parse(content) as ExtractionResult;

      // Validate structure
      if (!Array.isArray(parsed.entities)) parsed.entities = [];
      if (!Array.isArray(parsed.relationships)) parsed.relationships = [];
      if (!parsed.summary) parsed.summary = '';

      return parsed;
    } catch (error) {
      this.logger.error(['Error calling LLM for knowledge extraction', error?.message]);
      return null;
    }
  }

  private async saveExtraction(
    instanceId: string,
    remoteJid: string,
    pushName: string | undefined,
    extraction: ExtractionResult,
    existingId?: string,
  ) {
    // Upsert the ContactKnowledge record
    const contactKnowledge = await this.prismaRepository.contactKnowledge.upsert({
      where: { remoteJid_instanceId: { remoteJid, instanceId } },
      create: {
        remoteJid,
        instanceId,
        pushName,
        summary: extraction.summary,
      },
      update: {
        pushName,
        summary: extraction.summary,
      },
    });

    // Upsert entities (merge by category+label)
    for (const entity of extraction.entities) {
      const existingEntity = await this.prismaRepository.knowledgeEntity.findFirst({
        where: {
          contactKnowledgeId: contactKnowledge.id,
          category: entity.category,
          label: entity.label,
        },
      });

      if (existingEntity) {
        await this.prismaRepository.knowledgeEntity.update({
          where: { id: existingEntity.id },
          data: {
            value: entity.value,
            confidence: entity.confidence,
            source: 'chat_extraction',
          },
        });
      } else {
        await this.prismaRepository.knowledgeEntity.create({
          data: {
            contactKnowledgeId: contactKnowledge.id,
            category: entity.category,
            label: entity.label,
            value: entity.value,
            confidence: entity.confidence,
            source: 'chat_extraction',
          },
        });
      }
    }

    // Save relationships
    for (const rel of extraction.relationships) {
      const fromEntity = await this.prismaRepository.knowledgeEntity.findFirst({
        where: { contactKnowledgeId: contactKnowledge.id, label: rel.fromLabel },
      });
      const toEntity = await this.prismaRepository.knowledgeEntity.findFirst({
        where: { contactKnowledgeId: contactKnowledge.id, label: rel.toLabel },
      });

      if (fromEntity && toEntity) {
        // Check if relationship already exists
        const existingRel = await this.prismaRepository.knowledgeRelationship.findFirst({
          where: {
            contactKnowledgeId: contactKnowledge.id,
            fromEntityId: fromEntity.id,
            toEntityId: toEntity.id,
            type: rel.type,
          },
        });

        if (!existingRel) {
          await this.prismaRepository.knowledgeRelationship.create({
            data: {
              contactKnowledgeId: contactKnowledge.id,
              fromEntityId: fromEntity.id,
              toEntityId: toEntity.id,
              type: rel.type,
              description: rel.description,
            },
          });
        }
      }
    }
  }

  // ============================
  // Public API methods
  // ============================

  public async getContactKnowledge(instanceId: string, remoteJid: string) {
    return this.prismaRepository.contactKnowledge.findUnique({
      where: { remoteJid_instanceId: { remoteJid, instanceId } },
      include: {
        entities: { orderBy: { category: 'asc' } },
        relationships: {
          include: { fromEntity: true, toEntity: true },
        },
      },
    });
  }

  public async listContactsWithKnowledge(instanceId: string) {
    return this.prismaRepository.contactKnowledge.findMany({
      where: { instanceId },
      include: {
        entities: { orderBy: { category: 'asc' } },
        _count: { select: { entities: true, relationships: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  public async deleteContactKnowledge(instanceId: string, remoteJid: string) {
    return this.prismaRepository.contactKnowledge.delete({
      where: { remoteJid_instanceId: { remoteJid, instanceId } },
    });
  }

  public async getEntitiesByCategory(instanceId: string, remoteJid: string, category: string) {
    const knowledge = await this.prismaRepository.contactKnowledge.findUnique({
      where: { remoteJid_instanceId: { remoteJid, instanceId } },
    });

    if (!knowledge) return [];

    return this.prismaRepository.knowledgeEntity.findMany({
      where: {
        contactKnowledgeId: knowledge.id,
        category: category.toUpperCase(),
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  public async forceExtraction(instanceId: string, remoteJid: string, messageCount = 50) {
    // Fetch recent messages from DB
    const messages = await this.prismaRepository.message.findMany({
      where: {
        instanceId,
        key: { path: ['remoteJid'], equals: remoteJid },
      },
      orderBy: { messageTimestamp: 'desc' },
      take: messageCount,
    });

    if (messages.length === 0) return null;

    const messageTexts = messages
      .reverse()
      .map((m: any) => {
        const fromMe = m.key?.fromMe;
        const text =
          m.message?.conversation ||
          m.message?.extendedTextMessage?.text ||
          m.message?.imageMessage?.caption ||
          m.message?.videoMessage?.caption ||
          '';
        if (!text) return null;
        return `[${fromMe ? 'Bot' : m.pushName || 'Cliente'}]: ${text}`;
      })
      .filter(Boolean);

    if (messageTexts.length === 0) return null;

    // Get existing knowledge for context
    const existing = await this.prismaRepository.contactKnowledge.findUnique({
      where: { remoteJid_instanceId: { remoteJid, instanceId } },
      include: { entities: true },
    });

    const existingContext = existing
      ? `Resumo: ${existing.summary || 'Nenhum'}\nEntidades conhecidas: ${existing.entities.map((e) => `${e.category}:${e.label}=${e.value}`).join(', ') || 'Nenhuma'}`
      : 'Nenhuma informação prévia sobre este cliente.';

    const prompt = EXTRACTION_PROMPT
      .replace('{existingContext}', existingContext)
      .replace('{messages}', messageTexts.join('\n'));

    const extraction = await this.callLLM(prompt, instanceId);
    if (!extraction) return null;

    await this.saveExtraction(instanceId, remoteJid, undefined, extraction, existing?.id);

    return this.getContactKnowledge(instanceId, remoteJid);
  }
}
