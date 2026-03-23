import { Router } from 'express';
import { validate } from '../middleware/validation.js';
import { updateOrderStatusSchema } from '../schemas/order.schema.js';
import * as order from '../controllers/order.controller.js';

const router = Router();

router.get('/', order.listOrders);
router.get('/:id', order.getOrder);
router.patch('/:id/status', validate({ body: updateOrderStatusSchema }), order.updateOrderStatus);

export default router;
