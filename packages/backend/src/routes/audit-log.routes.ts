import { Router } from 'express';
import * as auditLog from '../controllers/audit-log.controller.js';

const router = Router();

router.get('/', auditLog.listAuditLogs);

export default router;
