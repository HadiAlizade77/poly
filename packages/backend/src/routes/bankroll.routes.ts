import { Router } from 'express';
import * as bankroll from '../controllers/bankroll.controller.js';

const router = Router();

router.get('/', bankroll.getBankroll);
router.patch('/', bankroll.updateBankroll);
router.post('/set-balance', bankroll.setBalance);
router.get('/history', bankroll.getBankrollHistory);

export default router;
