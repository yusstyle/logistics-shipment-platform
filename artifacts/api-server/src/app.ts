import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use((req, _res, next) => {
  const matchedPath = req.headers["x-matched-path"] || req.headers["x-invoke-path"];
  if (typeof matchedPath === "string" && matchedPath.startsWith("/api") && req.url === "/api") {
    req.url = matchedPath;
  }
  next();
});
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  express.json({
    limit: "1mb",
    verify(req, _res, buffer) {
      (req as express.Request).rawBody = Buffer.from(buffer);
    },
  }),
);
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  if (!process.env.CLERK_SECRET_KEY) {
    return next();
  }
  return clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
    secretKey: process.env.CLERK_SECRET_KEY,
  }))(req, res, next);
});

app.use("/api", router);
app.use(router);

app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
  req.log?.[status >= 500 ? "error" : "warn"](
    { err: error, status },
    "API request failed",
  );
  const message =
    status < 500 && error instanceof Error
      ? error.message
      : "The request could not be completed.";
  res.status(status).json({ error: message });
});

export default app;
