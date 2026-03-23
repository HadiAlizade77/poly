import { Router } from 'express';
import * as alert from '../controllers/alert.controller.js';

const router = Router();

router.get('/', alert.listAlerts);
router.get('/unread-count', alert.getUnreadCount);
router.patch('/mark-all-read', alert.markAllRead);
router.patch('/:id/read', alert.markAlertRead);
router.patch('/:id/dismiss', alert.dismissAlert);

export default router;
