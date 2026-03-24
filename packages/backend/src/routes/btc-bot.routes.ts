import { Router } from 'express';
import * as btcBot from '../controllers/btc-bot.controller.js';

const router = Router();

router.get('/status', btcBot.getBotStatus);
router.get('/trades', btcBot.getTrades);
router.get('/logs',   btcBot.getLogs);
router.post('/start', btcBot.startBot);
router.post('/stop',  btcBot.stopBot);

export default router;
