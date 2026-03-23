import { Router } from 'express';
import * as analytics from '../controllers/analytics.controller.js';

const router = Router();

router.get('/summary', analytics.getSummaryStats);

export default router;
