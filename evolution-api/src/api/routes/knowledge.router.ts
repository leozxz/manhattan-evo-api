import { knowledgeController } from '@api/server.module';
import { waMonitor } from '@api/server.module';
import { RequestHandler, Router } from 'express';

import { HttpStatus } from './index.router';

export class KnowledgeRouter {
  public readonly router: Router = Router();

  constructor(...guards: RequestHandler[]) {
    this.router
      // List all contacts with knowledge for an instance
      .get('/knowledge/contacts/:instanceName', ...guards, async (req, res) => {
        try {
          const { instanceName } = req.params;
          const instanceId = waMonitor.waInstances[instanceName]?.instanceId;
          if (!instanceId) {
            return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Instance not found' });
          }
          const response = await knowledgeController.listContacts({ instanceName }, instanceId);
          return res.status(HttpStatus.OK).json(response);
        } catch (error) {
          return res.status(HttpStatus.BAD_REQUEST).json({ error: error?.message });
        }
      })

      // Get knowledge graph for a specific contact
      .get('/knowledge/contact/:instanceName', ...guards, async (req, res) => {
        try {
          const { instanceName } = req.params;
          const { remoteJid } = req.query as { remoteJid: string };
          if (!remoteJid) {
            return res.status(HttpStatus.BAD_REQUEST).json({ error: 'remoteJid is required as query parameter' });
          }
          const instanceId = waMonitor.waInstances[instanceName]?.instanceId;
          if (!instanceId) {
            return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Instance not found' });
          }
          const response = await knowledgeController.getContactKnowledge({ instanceName }, instanceId, { remoteJid });
          return res.status(HttpStatus.OK).json(response);
        } catch (error) {
          return res.status(HttpStatus.BAD_REQUEST).json({ error: error?.message });
        }
      })

      // Get entities by category for a contact
      .get('/knowledge/entities/:instanceName', ...guards, async (req, res) => {
        try {
          const { instanceName } = req.params;
          const { remoteJid, category } = req.query as { remoteJid: string; category: string };
          if (!remoteJid || !category) {
            return res.status(HttpStatus.BAD_REQUEST).json({ error: 'remoteJid and category are required query parameters' });
          }
          const instanceId = waMonitor.waInstances[instanceName]?.instanceId;
          if (!instanceId) {
            return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Instance not found' });
          }
          const response = await knowledgeController.getEntitiesByCategory({ instanceName }, instanceId, { remoteJid, category });
          return res.status(HttpStatus.OK).json(response);
        } catch (error) {
          return res.status(HttpStatus.BAD_REQUEST).json({ error: error?.message });
        }
      })

      // Force extraction from existing messages
      .post('/knowledge/extract/:instanceName', ...guards, async (req, res) => {
        try {
          const { instanceName } = req.params;
          const { remoteJid, messageCount } = req.body;
          if (!remoteJid) {
            return res.status(HttpStatus.BAD_REQUEST).json({ error: 'remoteJid is required in body' });
          }
          const instanceId = waMonitor.waInstances[instanceName]?.instanceId;
          if (!instanceId) {
            return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Instance not found' });
          }
          const response = await knowledgeController.forceExtraction({ instanceName }, instanceId, { remoteJid, messageCount });
          if (!response) {
            return res.status(HttpStatus.OK).json({ message: 'No messages found or extraction failed' });
          }
          return res.status(HttpStatus.OK).json(response);
        } catch (error) {
          return res.status(HttpStatus.BAD_REQUEST).json({ error: error?.message });
        }
      })

      // Delete knowledge for a contact
      .delete('/knowledge/contact/:instanceName', ...guards, async (req, res) => {
        try {
          const { instanceName } = req.params;
          const { remoteJid } = req.query as { remoteJid: string };
          if (!remoteJid) {
            return res.status(HttpStatus.BAD_REQUEST).json({ error: 'remoteJid is required as query parameter' });
          }
          const instanceId = waMonitor.waInstances[instanceName]?.instanceId;
          if (!instanceId) {
            return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Instance not found' });
          }
          const response = await knowledgeController.deleteContactKnowledge({ instanceName }, instanceId, { remoteJid });
          return res.status(HttpStatus.OK).json(response);
        } catch (error) {
          return res.status(HttpStatus.BAD_REQUEST).json({ error: error?.message });
        }
      });
  }
}
