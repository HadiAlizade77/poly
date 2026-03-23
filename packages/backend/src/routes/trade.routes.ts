import { Router } from 'express';
import * as trade from '../controllers/trade.controller.js';

const router = Router();

router.get('/', trade.listTrades);
router.get('/stats', trade.getTradeStats);
router.get('/:id', trade.getTrade);

export default router;
