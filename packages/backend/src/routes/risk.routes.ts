import { Router } from 'express';
import { validate } from '../middleware/validation.js';
import { riskConfigSchema } from '../schemas/risk.schema.js';
import * as risk from '../controllers/risk.controller.js';

const router = Router();

router.get('/events', risk.listRiskEvents);
router.get('/config', risk.getRiskConfig);
router.put('/config', validate({ body: riskConfigSchema }), risk.updateRiskConfig);
router.get('/kill-switch', risk.getKillSwitchStatus);
router.patch('/kill-switch', risk.toggleKillSwitch);

// ─── Risk appetite ────────────────────────────────────────────────────────────
router.get('/appetite', risk.getRiskAppetite);
router.patch('/appetite', risk.setRiskAppetite);

// ─── AI risk auto-tune ────────────────────────────────────────────────────────
router.get('/auto-tune', risk.getAutoTuneStatus);
router.post('/auto-tune', risk.autoTuneRisk);
router.delete('/auto-tune', risk.disableAutoTune);

// ─── Trading state ───────────────────────────────────────────────────────────
router.get('/trading-state', risk.getTradingState);
router.patch('/trading-state', risk.setTradingState);

export default router;
