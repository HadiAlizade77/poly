import { Router } from 'express';
import * as decision from '../controllers/decision.controller.js';

const router = Router();

router.get('/', decision.listDecisions);
router.get('/stats', decision.getDecisionStats);
router.get('/:id', decision.getDecision);

export default router;
