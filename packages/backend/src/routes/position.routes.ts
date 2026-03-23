import { Router } from 'express';
import { validate } from '../middleware/validation.js';
import { exitStrategySchema } from '../schemas/position.schema.js';
import * as position from '../controllers/position.controller.js';

const router = Router();

router.get('/', position.listPositions);
router.get('/:id', position.getPosition);
router.patch(
  '/:id/exit-strategy',
  validate({ body: exitStrategySchema }),
  position.updateExitStrategy,
);
router.post('/:id/close', position.closePosition);

export default router;
