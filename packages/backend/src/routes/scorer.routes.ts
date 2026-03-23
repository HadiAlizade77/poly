import { Router } from 'express';
import { validate } from '../middleware/validation.js';
import { upsertScorerConfigSchema } from '../schemas/scorer.schema.js';
import * as scorer from '../controllers/scorer.controller.js';

const router = Router();

router.get('/', scorer.listScorerConfigs);
router.get('/scores', scorer.listContextScores);
router.get('/:id', scorer.getScorerConfig);
router.put('/', validate({ body: upsertScorerConfigSchema }), scorer.upsertScorerConfig);
router.patch('/:id/toggle', scorer.toggleScorer);

export default router;
