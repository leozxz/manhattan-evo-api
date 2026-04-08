import { InstanceDto } from '@api/dto/instance.dto';
import { KnowledgeExtractorService } from '@api/services/knowledge-extractor.service';

export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeExtractorService) {}

  public async getContactKnowledge({ instanceName }: InstanceDto, instanceId: string, data: { remoteJid: string }) {
    return this.knowledgeService.getContactKnowledge(instanceId, data.remoteJid);
  }

  public async listContacts({ instanceName }: InstanceDto, instanceId: string) {
    return this.knowledgeService.listContactsWithKnowledge(instanceId);
  }

  public async deleteContactKnowledge({ instanceName }: InstanceDto, instanceId: string, data: { remoteJid: string }) {
    return this.knowledgeService.deleteContactKnowledge(instanceId, data.remoteJid);
  }

  public async getEntitiesByCategory(
    { instanceName }: InstanceDto,
    instanceId: string,
    data: { remoteJid: string; category: string },
  ) {
    return this.knowledgeService.getEntitiesByCategory(instanceId, data.remoteJid, data.category);
  }

  public async forceExtraction(
    { instanceName }: InstanceDto,
    instanceId: string,
    data: { remoteJid: string; messageCount?: number },
  ) {
    return this.knowledgeService.forceExtraction(instanceId, data.remoteJid, data.messageCount);
  }
}
