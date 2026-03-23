import { Router } from 'express';
import { validate } from '../middleware/validation.js';
import { setSystemConfigSchema } from '../schemas/system-config.schema.js';
import * as system from '../controllers/system.controller.js';

const router = Router();

router.get('/health', system.getHealth);
router.get('/config', system.getConfig);
router.get('/system-config', system.getSystemConfigs);
router.get('/system-config/:key', system.getSystemConfigs);
router.put('/system-config/:key', validate({ body: setSystemConfigSchema }), system.setSystemConfig);
router.delete('/system-config/:key', system.deleteSystemConfig);

export default router;
