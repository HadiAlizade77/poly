import { Router } from 'express';
import authRoutes from './auth.routes.js';
import systemRoutes from './system.routes.js';
import marketRoutes from './market.routes.js';
import scorerRoutes from './scorer.routes.js';
import decisionRoutes from './decision.routes.js';
import orderRoutes from './order.routes.js';
import tradeRoutes from './trade.routes.js';
import positionRoutes from './position.routes.js';
import riskRoutes from './risk.routes.js';
import bankrollRoutes from './bankroll.routes.js';
import alertRoutes from './alert.routes.js';
import analyticsRoutes from './analytics.routes.js';
import auditLogRoutes from './audit-log.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/', systemRoutes);
router.use('/markets', marketRoutes);
router.use('/scorers', scorerRoutes);
router.use('/decisions', decisionRoutes);
router.use('/orders', orderRoutes);
router.use('/trades', tradeRoutes);
router.use('/positions', positionRoutes);
router.use('/risk', riskRoutes);
router.use('/bankroll', bankrollRoutes);
router.use('/alerts', alertRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/audit-log', auditLogRoutes);

export default router;
