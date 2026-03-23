import { Router } from 'express';
import { validate } from '../middleware/validation.js';
import {
  createMarketSchema,
  updateMarketSchema,
  marketStatusSchema,
} from '../schemas/market.schema.js';
import * as market from '../controllers/market.controller.js';

const router = Router();

router.get('/', market.listMarkets);
router.get('/:id', market.getMarket);
router.post('/', validate({ body: createMarketSchema }), market.createMarket);
router.put('/:id', validate({ body: updateMarketSchema }), market.updateMarket);
router.patch('/:id/status', validate({ body: marketStatusSchema }), market.setMarketStatus);

export default router;
