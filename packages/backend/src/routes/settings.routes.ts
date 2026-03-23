import { Router } from 'express';
import { validate } from '../middleware/validation.js';
import * as settings from '../controllers/settings.controller.js';

const router = Router();

// ─── Credentials ──────────────────────────────────────────────────────────────

router.get('/credentials', settings.getCredentials);

router.put(
  '/credentials',
  validate({ body: settings.credentialsBodySchema }),
  settings.setCredentials,
);
router.post(
  '/credentials',
  validate({ body: settings.credentialsBodySchema }),
  settings.setCredentials,
);

// ─── AI configuration ─────────────────────────────────────────────────────────

router.get('/ai-config', settings.getAiConfig);

router.put(
  '/ai-config',
  validate({ body: settings.aiConfigBodySchema }),
  settings.setAiConfig,
);
router.post(
  '/ai-config',
  validate({ body: settings.aiConfigBodySchema }),
  settings.setAiConfig,
);

export default router;
