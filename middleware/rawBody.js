import crypto from "crypto";

export const captureRawBody = (req, res, buf, encoding) => {
  if (buf && buf.length) {
    req.rawBody = buf;
    // console.log(`[rawBody] captured ${buf.length} bytes for ${req.path}`);
  }
};

export const rawBodyMiddleware = (req, res, next) => {
  if (req.rawBody) {
    // console.log(`[rawBody] already have rawBody, skipping`);
    return next();
  }

  let data = [];
  req.on("data", (chunk) => data.push(chunk));
  req.on("end", () => {
    req.rawBody = Buffer.concat(data);
    // console.log(`[rawBody] stream captured ${req.rawBody.length} bytes`);
    next();
  });
  req.on("error", (err) => {
    console.error(`[rawBody] stream error:`, err);
    next(err);
  });
};
