import { Router } from 'express';
import * as settings from '../controllers/settings.controller.js';

const router = Router();

// ─── OpenRouter models ────────────────────────────────────────────────────────

router.get('/openrouter-models', settings.getOpenRouterModels);

export default router;
