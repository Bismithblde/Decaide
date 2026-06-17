const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

loadDotEnv();

const DEFAULT_PORT = Number(process.env.PORT || 3000);
const MAX_JSON_BODY_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_SEARCH_RADIUS_METERS = 5000;
const MAX_PHOTOS_TO_SCAN = 10;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function loadDotEnv() {
  const envPath = path.join(__dirname, "..", ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    const name = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");

    if (name && process.env[name] === undefined) {
      process.env[name] = value;
    }
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);

  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function getEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new ServerConfigError(`${name} is required`);
  }

  return value;
}

class HttpError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

class ServerConfigError extends Error {}

class UpstreamError extends Error {
  constructor(provider, statusCode, payload) {
    super(`${provider} request failed`);
    this.provider = provider;
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

function normalizePath(req) {
  return new URL(req.url, "http://localhost").pathname;
}

function attachRequestLogger(req, res, path) {
  const startedAt = Date.now();

  res.once("finish", () => {
    const elapsedMs = Date.now() - startedAt;

    console.log(`${req.method} ${path} -> ${res.statusCode} ${elapsedMs}ms`);
  });
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function assertLatitude(value) {
  return isFiniteNumber(value) && value >= -90 && value <= 90;
}

function assertLongitude(value) {
  return isFiniteNumber(value) && value >= -180 && value <= 180;
}

function assertRadius(value) {
  return (
    value === undefined ||
    (isFiniteNumber(value) && value > 0 && value <= 50000)
  );
}

function assertPlaceId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{10,256}$/.test(value);
}

function validateSearchBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(
      400,
      "invalid_request",
      "Request body must be a JSON object.",
    );
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";

  if (!query) {
    throw new HttpError(400, "invalid_request", "query is required.");
  }

  if (!assertLatitude(body.latitude) || !assertLongitude(body.longitude)) {
    throw new HttpError(
      400,
      "invalid_request",
      "latitude and longitude are required.",
    );
  }

  if (!assertRadius(body.radiusMeters)) {
    throw new HttpError(
      400,
      "invalid_request",
      "radiusMeters must be greater than 0 and at most 50000.",
    );
  }

  return {
    query,
    latitude: body.latitude,
    longitude: body.longitude,
    radiusMeters: body.radiusMeters || DEFAULT_SEARCH_RADIUS_METERS,
  };
}

function validateMenuBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(
      400,
      "invalid_request",
      "Request body must be a JSON object.",
    );
  }

  if (!assertPlaceId(body.placeId)) {
    throw new HttpError(400, "invalid_request", "placeId is required.");
  }

  return {
    placeId: body.placeId,
  };
}

function parseImageDataUrl(value) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(value);

  if (!match) {
    return null;
  }

  return {
    contentType: match[1].toLowerCase(),
    base64: match[2],
  };
}

function normalizeBase64Image({ imageBase64, imageDataUrl, mimeType }) {
  if (typeof imageDataUrl === "string") {
    const parsed = parseImageDataUrl(imageDataUrl.trim());

    if (!parsed) {
      throw new HttpError(
        400,
        "invalid_request",
        "imageDataUrl must be a valid base64 data URL.",
      );
    }

    return parsed;
  }

  if (typeof imageBase64 !== "string" || !imageBase64.trim()) {
    throw new HttpError(
      400,
      "invalid_request",
      "imageBase64 or imageDataUrl is required.",
    );
  }

  return {
    contentType:
      typeof mimeType === "string" && mimeType.trim()
        ? mimeType.trim().toLowerCase()
        : "image/jpeg",
    base64: imageBase64,
  };
}

function validateUserMenuOcrBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(
      400,
      "invalid_request",
      "Request body must be a JSON object.",
    );
  }

  const image = normalizeBase64Image(body);
  const compactBase64 = image.base64.replace(/\s/g, "");
  const storeName =
    typeof body.storeName === "string" ? body.storeName.trim() : "";
  const location =
    typeof body.location === "string" ? body.location.trim() : "";

  if (!SUPPORTED_IMAGE_MIME_TYPES.has(image.contentType)) {
    throw new HttpError(
      400,
      "invalid_request",
      "Image must be a PNG, JPEG, WEBP, or non-animated GIF.",
    );
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compactBase64)) {
    throw new HttpError(400, "invalid_request", "Image must be valid base64.");
  }

  const imageBytes = Buffer.byteLength(compactBase64, "base64");

  if (imageBytes === 0 || imageBytes > MAX_IMAGE_BYTES) {
    throw new HttpError(
      413,
      "request_too_large",
      "Image must be greater than 0 bytes and at most 8 MB.",
    );
  }

  return {
    contentType: image.contentType,
    base64: compactBase64,
    storeName,
    location,
  };
}

async function parseJsonBody(req) {
  let size = 0;
  const chunks = [];

  for await (const chunk of req) {
    size += chunk.length;

    if (size > MAX_JSON_BODY_BYTES) {
      throw new HttpError(413, "request_too_large", "JSON body is too large.");
    }

    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(
      400,
      "invalid_json",
      "Request body must be valid JSON.",
    );
  }
}

async function readJsonResponse(response, provider) {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new UpstreamError(provider, response.status, payload);
  }

  return payload;
}

async function searchPlacesByText({
  query,
  latitude,
  longitude,
  radiusMeters,
}) {
  const apiKey = getEnv("GOOGLE_PLACES_API_KEY");
  const response = await fetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types",
      },
      body: JSON.stringify({
        textQuery: query,
        pageSize: 1,
        locationBias: {
          circle: {
            center: {
              latitude,
              longitude,
            },
            radius: radiusMeters,
          },
        },
      }),
    },
  );
  const payload = await readJsonResponse(response, "google_places");

  return payload.places?.[0] || null;
}

async function getPlaceDetails(placeId) {
  const apiKey = getEnv("GOOGLE_PLACES_API_KEY");
  const response = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,photos",
      },
    },
  );

  return readJsonResponse(response, "google_places");
}

async function getPhotoUri(photoName) {
  const apiKey = getEnv("GOOGLE_PLACES_API_KEY");
  const url = new URL(`https://places.googleapis.com/v1/${photoName}/media`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("maxWidthPx", "1600");
  url.searchParams.set("skipHttpRedirect", "true");

  const response = await fetch(url);
  const payload = await readJsonResponse(response, "google_places");

  if (!payload.photoUri) {
    throw new UpstreamError("google_places", response.status, payload);
  }

  return payload.photoUri;
}

async function downloadImage(photoUri) {
  const response = await fetch(photoUri);

  if (!response.ok) {
    throw new UpstreamError("place_photo_image", response.status, {});
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const bytes = Buffer.from(await response.arrayBuffer());

  return {
    contentType,
    base64: bytes.toString("base64"),
  };
}

function emptyProviderResult(error) {
  return {
    text: "",
    error,
  };
}

function upstreamErrorPayload(error) {
  if (error instanceof ServerConfigError) {
    return {
      code: "server_misconfigured",
      message: error.message,
    };
  }

  if (error instanceof UpstreamError) {
    return {
      code: "upstream_error",
      provider: error.provider,
      statusCode: error.statusCode,
    };
  }

  return {
    code: "unknown_error",
    message: error.message,
  };
}

async function ocrWithGoogleVision(image) {
  const apiKey = getEnv("GOOGLE_VISION_API_KEY");
  const url = new URL("https://vision.googleapis.com/v1/images:annotate");
  url.searchParams.set("key", apiKey);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          image: {
            content: image.base64,
          },
          features: [
            {
              type: "DOCUMENT_TEXT_DETECTION",
            },
          ],
        },
      ],
    }),
  });
  const payload = await readJsonResponse(response, "google_vision");
  const result = payload.responses?.[0];

  if (result?.error) {
    throw new UpstreamError("google_vision", 200, result.error);
  }

  return (
    result?.fullTextAnnotation?.text ||
    result?.textAnnotations?.[0]?.description ||
    ""
  );
}

async function ocrWithOpenAi(image) {
  const apiKey = getEnv("OPENAI_API_KEY");
  const model =
    process.env.OPENAI_OCR_MODEL ||
    process.env.OPENAI_MENU_MODEL ||
    "gpt-5.4-mini";
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Extract all visible text from this restaurant/place photo. Preserve line breaks where useful. Return only the extracted text.",
            },
            {
              type: "input_image",
              image_url: `data:${image.contentType};base64,${image.base64}`,
            },
          ],
        },
      ],
    }),
  });
  const payload = await readJsonResponse(response, "openai_ocr");

  return extractOpenAiText(payload);
}

function menuExtractionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["isMenu", "sourceUsed", "categories"],
    properties: {
      isMenu: {
        type: "boolean",
      },
      sourceUsed: {
        type: "string",
        enum: ["googleVision", "openai", "combined"],
      },
      categories: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "items"],
          properties: {
            name: {
              type: "string",
            },
            items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "description", "price"],
                properties: {
                  name: {
                    type: "string",
                  },
                  description: {
                    type: "string",
                  },
                  price: {
                    type: "string",
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function menuOnlineEnrichmentSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "foundMenu",
      "confidence",
      "finalText",
      "photoTextUsed",
      "queriesRun",
      "sources",
      "matchedPhotoItems",
      "filledFields",
      "notes",
    ],
    properties: {
      foundMenu: {
        type: "boolean",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
      finalText: {
        type: "string",
      },
      photoTextUsed: {
        type: "string",
      },
      queriesRun: {
        type: "array",
        items: {
          type: "string",
        },
      },
      sources: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["url", "title"],
          properties: {
            url: {
              type: "string",
            },
            title: {
              type: "string",
            },
          },
        },
      },
      matchedPhotoItems: {
        type: "array",
        items: {
          type: "string",
        },
      },
      filledFields: {
        type: "array",
        items: {
          type: "string",
        },
      },
      notes: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
  };
}

function menuItemParseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "description", "price"],
          properties: {
            name: {
              type: "string",
            },
            description: {
              type: "string",
            },
            price: {
              type: "string",
            },
          },
        },
      },
    },
  };
}

async function extractMenuTextFromImage(image) {
  const rawText = await ocrWithGoogleVision(image);

  return {
    model: "google_vision_document_text_detection",
    rawText,
    confidence: rawText ? "medium" : "low",
    uncertainText: [],
    warnings: rawText
      ? []
      : ["Google Vision did not detect text in this image."],
  };
}

function canSearchOnlineMenu({ storeName, location }) {
  return Boolean(process.env.TAVILY_API_KEY && storeName && location);
}

function photoOnlyEnrichment(ocr, reason) {
  return {
    attempted: false,
    foundMenu: false,
    confidence: 0,
    finalText: ocr.rawText,
    photoTextUsed: ocr.rawText,
    queriesRun: [],
    sources: [],
    matchedPhotoItems: [],
    filledFields: [],
    notes: [reason],
  };
}

async function enrichMenuWithTavilyMcp({ ocr, storeName, location }) {
  if (!canSearchOnlineMenu({ storeName, location })) {
    return photoOnlyEnrichment(
      ocr,
      "Online menu enrichment skipped because storeName, location, or TAVILY_API_KEY was missing.",
    );
  }

  const apiKey = getEnv("OPENAI_API_KEY");
  const tavilyApiKey = getEnv("TAVILY_API_KEY");
  const model =
    process.env.OPENAI_MENU_ENRICHMENT_MODEL ||
    process.env.OPENAI_MENU_MODEL ||
    "gpt-5.4-mini";
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      tools: [
        {
          type: "mcp",
          server_label: "tavily",
          server_url: `https://mcp.tavily.com/mcp/?tavilyApiKey=${encodeURIComponent(tavilyApiKey)}`,
          require_approval: "never",
          headers: {
            DEFAULT_PARAMETERS: JSON.stringify({
              include_favicon: true,
              include_images: false,
              include_raw_content: false,
            }),
          },
        },
      ],
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "You are a menu verification orchestrator using the Tavily MCP tools.",
                "The user photo OCR is the source of truth. Never override visible photo text.",
                "Use Tavily search with different targeted queries for the store name and location until you are at least 0.85 confident you found the right online menu, or until you have tried up to 5 searches.",
                "After identifying likely menu URLs, use Tavily extract on those URLs. Do not crawl or map websites.",
                "If no online menu reaches 0.85 confidence, or if the online menu does not share at least one concrete item name with the photo text, return foundMenu false and finalText exactly equal to the photo OCR.",
                "If a matching online menu is found, keep only items that appear in the photo OCR and use online content only to fill missing descriptions, options, or prices for those photo-visible items.",
                `Store name: ${storeName}`,
                `Location: ${location}`,
                `Photo OCR:\n${ocr.rawText}`,
              ].join("\n"),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "menu_online_enrichment",
          strict: true,
          schema: menuOnlineEnrichmentSchema(),
        },
      },
    }),
  });
  const payload = await readJsonResponse(response, "openai_menu_enrichment");
  const text = extractOpenAiText(payload);
  const enrichment = JSON.parse(text);

  if (
    !enrichment.foundMenu ||
    enrichment.confidence < 0.85 ||
    enrichment.matchedPhotoItems.length === 0
  ) {
    return {
      attempted: true,
      ...enrichment,
      foundMenu: false,
      finalText: ocr.rawText,
      photoTextUsed: ocr.rawText,
    };
  }

  return {
    attempted: true,
    ...enrichment,
  };
}

function normalizeMenuItemName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isStandaloneMenuItem(item) {
  const name = normalizeMenuItemName(item.name);
  const normalized = name.toLowerCase();

  if (!name || name.length < 3) {
    return false;
  }

  if (/^\(?original\)?$/i.test(name)) {
    return false;
  }

  if (
    /\b(topping|add[-\s]?on|add on|sweet(?:ness)?|ice level|less ice|no ice|size|hot|cold|regular|large|medium|small)\b/i.test(
      name,
    )
  ) {
    return false;
  }

  if (
    /\bsugar\s+level\b|\blevel\s+of\s+sugar\b|\bsweet(?:ness)?\s+level\b/i.test(
      name,
    )
  ) {
    return false;
  }

  if (/\b\d+\s*g\s*\/\s*l\b/i.test(name) || /\b\d+\s*%/.test(name)) {
    return false;
  }

  if (/^\d+(?:\.\d+)?\s*(g|kg|ml|l|oz)\b/i.test(name)) {
    return false;
  }

  const optionOnlyNames = new Set([
    "normal",
    "less",
    "more",
    "none",
    "half",
    "zero",
    "extra",
    "regular",
    "large",
    "medium",
    "small",
  ]);

  return !optionOnlyNames.has(normalized);
}

function sanitizeMenuItems(items) {
  const seen = new Set();
  const sanitized = [];

  for (const item of Array.isArray(items) ? items : []) {
    const name = normalizeMenuItemName(item.name);

    if (!isStandaloneMenuItem({ ...item, name })) {
      continue;
    }

    const key = name.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    sanitized.push({
      name,
      description:
        typeof item.description === "string" ? item.description.trim() : "",
      price: typeof item.price === "string" ? item.price.trim() : "",
    });
  }

  return sanitized;
}

function truncateForLog(text, maxLength = 2000) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}... [truncated ${text.length - maxLength} chars]`;
}

async function parseFoodItemsWithMiniModel({ menuText, image }) {
  if (!menuText.trim()) {
    return {
      model: process.env.OPENAI_MENU_PARSE_MODEL || "gpt-5.4-mini",
      items: [],
    };
  }

  const apiKey = getEnv("OPENAI_API_KEY");
  const model = process.env.OPENAI_MENU_PARSE_MODEL || "gpt-5.4-mini";
  console.log("openai_menu_item_parse before_interpretation:");
  console.log(truncateForLog(menuText));
  const promptText = [
    "You are an OCR text interpreter and cleaner for restaurant menus.",
    "After OCR completes, you receive raw OCR text. Clean and interpret that text into structured menu items.",
    "You are also given the original menu image. Use the image layout as supporting evidence to decide whether OCR lines are standalone orderable items, section headers, toppings, or modifiers.",
    "The OCR text is the main source for words and prices; the image is for layout and context.",
    "Use the image to merge OCR fragments that belong to the same visual menu card or row, especially when a name wraps across multiple lines before its price.",
    "Only extract food items, drinks, and other complete orderable main items.",
    "Exclude everything that is not food, drink, or directly orderable as a standalone menu item.",
    "Exclude all modifiers and customization choices, including toppings, add-ons, sugar level, sweetness level, hot or cold options, ice level, spice level, size, flavor variants without a base item, calories, headings, notes, hours, addresses, and disclaimers.",
    "Only return items a customer could reasonably order by saying the item name alone.",
    "If an OCR line looks like an incomplete main item name, complete it only when the rest of the menu makes the intended item obvious.",
    "If an incomplete or damaged item name could reasonably be more than one item, keep the uncertain part as a question mark instead of guessing.",
    "Examples: if the menu context clearly shows milk tea drinks and OCR says 'Brown Sugar Bo', return 'Brown Sugar Boba'; if OCR says 'Chicken' and it could be Chicken Bowl or Chicken Sandwich, return 'Chicken ?'.",
    "Do not reject a real item just because one word can also be a modifier. Words like Brown Sugar, Cheese, Cloud, Jelly, Coconut, Boba, Milk, Tea, or Matcha can be part of an orderable drink or food name.",
    "Reject those words only when the image/layout/OCR shows they are listed as toppings, extras, sizes, sweetness levels, or other customization choices.",
    "If a branded item name is split across nearby OCR lines, combine the fragments when the image layout makes it clear they are one priced item. For example, a row/card containing 'Supreme Brown Sugar' near 'Boba Milk Tea' with one price should become one orderable item rather than being discarded as a modifier.",
    "Examples to exclude as standalone items: Original, Coffee Jelly (topping), 40 g/L sugar level, 50% sugar, hot, cold, less ice, mild, medium, spicy, large.",
    "Examples to include: Coffee Jelly Milk Tea, Brown Sugar Boba, Cheese Slice, Garlic Knots.",
    "Use the OCR text as truth. Do not invent missing menu items.",
    "If a line is ambiguous and might be a topping/modifier instead of a standalone orderable item, exclude it.",
    "Preserve prices and descriptions only if visible in the OCR text.",
    `OCR text:\n${menuText}`,
  ].join("\n");

  console.log("openai_menu_item_parse input_chars:", menuText.length);
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: promptText,
            },
            {
              type: "input_image",
              image_url: `data:${image.contentType};base64,${image.base64}`,
              detail: "low",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "menu_item_parse",
          strict: true,
          schema: menuItemParseSchema(),
        },
      },
    }),
  });
  const payload = await readJsonResponse(response, "openai_menu_item_parse");
  const text = extractOpenAiText(payload);
  const parsed = JSON.parse(text);
  const items = sanitizeMenuItems(parsed.items);

  console.log("openai_menu_item_parse items:", items.map((item) => item.name));

  return {
    model,
    items,
  };
}

async function extractMenuFromOcr(ocr) {
  const apiKey = getEnv("OPENAI_API_KEY");
  const model = process.env.OPENAI_MENU_MODEL || "gpt-5.4-mini";
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "You classify OCR from restaurant/place photos. If the OCR is a menu, extract menu categories, item names, descriptions, and prices. If not a menu, return isMenu false and an empty categories array. Prefer exact OCR text over guessing.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Google Vision OCR:\n${ocr.googleVision.text || ""}\n\nOpenAI OCR:\n${ocr.openai.text || ""}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "menu_extraction",
          strict: true,
          schema: menuExtractionSchema(),
        },
      },
    }),
  });
  const payload = await readJsonResponse(response, "openai_menu");
  const text = extractOpenAiText(payload);

  return JSON.parse(text);
}

function extractOpenAiText(payload) {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const chunks = [];

  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

async function runOcrProviders(image) {
  const [googleVision, openai] = await Promise.all([
    ocrWithGoogleVision(image)
      .then((text) => ({
        text,
        error: null,
      }))
      .catch((error) => emptyProviderResult(upstreamErrorPayload(error))),
    ocrWithOpenAi(image)
      .then((text) => ({
        text,
        error: null,
      }))
      .catch((error) => emptyProviderResult(upstreamErrorPayload(error))),
  ]);

  return {
    googleVision,
    openai,
  };
}

function mapPlaceSearchResult(place) {
  return {
    placeId: place.id,
    name: place.displayName?.text || "",
    formattedAddress: place.formattedAddress || "",
    location: place.location || null,
    primaryType: place.primaryType || "",
    types: place.types || [],
  };
}

async function handlePlaceSearch(req, res) {
  const body = validateSearchBody(await parseJsonBody(req));
  const place = await searchPlacesByText(body);

  if (!place) {
    throw new HttpError(404, "place_not_found", "No matching place was found.");
  }

  sendJson(res, 200, mapPlaceSearchResult(place));
}

async function handlePlaceMenu(req, res) {
  const { placeId } = validateMenuBody(await parseJsonBody(req));
  const details = await getPlaceDetails(placeId);
  const photos = Array.isArray(details.photos)
    ? details.photos.slice(0, MAX_PHOTOS_TO_SCAN)
    : [];

  if (photos.length === 0) {
    throw new HttpError(
      404,
      "no_photos",
      "No photos were available for this place.",
    );
  }

  const attempts = [];

  for (const [photoIndex, photo] of photos.entries()) {
    const photoUri = await getPhotoUri(photo.name);
    const image = await downloadImage(photoUri);
    const ocr = await runOcrProviders(image);
    const attempt = {
      photoIndex,
      photoName: photo.name,
      ocr,
    };

    attempts.push(attempt);

    if (!ocr.googleVision.text && !ocr.openai.text) {
      continue;
    }

    const menuResult = await extractMenuFromOcr(ocr);

    if (menuResult.isMenu) {
      sendJson(res, 200, {
        placeId: details.id || placeId,
        placeName: details.displayName?.text || "",
        menuFound: true,
        photoIndex,
        photoName: photo.name,
        ocr,
        menu: {
          sourceUsed: menuResult.sourceUsed,
          categories: menuResult.categories,
        },
      });
      return;
    }
  }

  sendJson(res, 200, {
    placeId: details.id || placeId,
    placeName: details.displayName?.text || "",
    menuFound: false,
    photosInspected: photos.length,
    attempts,
    menu: null,
  });
}

async function handleMenuOcr(req, res) {
  const image = validateUserMenuOcrBody(await parseJsonBody(req));
  const ocr = await extractMenuTextFromImage(image);
  const onlineEnrichment = await enrichMenuWithTavilyMcp({
    ocr,
    storeName: image.storeName,
    location: image.location,
  });
  const parsedMenu = await parseFoodItemsWithMiniModel({
    menuText: onlineEnrichment.finalText,
    image,
  });

  sendJson(res, 200, {
    model: ocr.model,
    parseModel: parsedMenu.model,
    api: "openai_responses",
    ocrProvider: "google_vision",
    text: onlineEnrichment.finalText,
    photoText: ocr.rawText,
    foodItems: parsedMenu.items,
    confidence: ocr.confidence,
    uncertainText: ocr.uncertainText,
    warnings: ocr.warnings,
    onlineEnrichment,
  });
}

function handleError(res, error) {
  if (error instanceof HttpError) {
    sendJson(res, error.statusCode, {
      error: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }

  if (error instanceof ServerConfigError) {
    sendJson(res, 500, {
      error: "server_misconfigured",
      message: error.message,
    });
    return;
  }

  if (error instanceof UpstreamError) {
    sendJson(res, 502, {
      error: "upstream_error",
      provider: error.provider,
      statusCode: error.statusCode,
    });
    return;
  }

  sendJson(res, 500, {
    error: "internal_error",
  });
}

async function requestHandler(req, res) {
  const path = normalizePath(req);

  attachRequestLogger(req, res, path);

  try {
    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, {
        status: "ok",
        service: "decaide-backend",
      });
      return;
    }

    if (req.method === "POST" && path === "/api/places/search") {
      await handlePlaceSearch(req, res);
      return;
    }

    if (req.method === "POST" && path === "/api/places/menu") {
      await handlePlaceMenu(req, res);
      return;
    }

    if (req.method === "POST" && path === "/api/menu/ocr") {
      await handleMenuOcr(req, res);
      return;
    }

    sendJson(res, 404, {
      error: "not_found",
    });
  } catch (error) {
    handleError(res, error);
  }
}

function createServer() {
  return http.createServer(requestHandler);
}

function startServer(port = DEFAULT_PORT) {
  const server = createServer();

  server.listen(port, () => {
    const address = server.address();
    const actualPort =
      typeof address === "object" && address ? address.port : port;

    console.log(`Decaide backend listening on http://localhost:${actualPort}`);
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createServer,
  requestHandler,
  startServer,
};
