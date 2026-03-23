import { Router } from 'express';
import * as sandbox from '../controllers/sandbox.controller.js';

const router = Router();

router.get('/status', sandbox.getSandboxStatus);
router.post('/start', sandbox.startSandbox);
router.post('/reset', sandbox.resetSandbox);
router.post('/stop', sandbox.stopSandbox);
router.get('/analytics', sandbox.getSandboxAnalytics);

export default router;
