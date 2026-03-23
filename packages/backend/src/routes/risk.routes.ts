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

export default router;
