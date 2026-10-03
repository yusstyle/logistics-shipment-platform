import { Router, type IRouter } from "express";
import adminRouter from "./admin";
import healthRouter from "./health";
import publicRouter from "./public";
import webhookRouter from "./webhooks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(publicRouter);
router.use(adminRouter);
router.use(webhookRouter);

export default router;
