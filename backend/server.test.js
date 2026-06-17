const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');

const { createServer } = require('./server');

const nativeFetch = global.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function imageResponse() {
  return new Response(Buffer.from('fake-image'), {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
    },
  });
}

function parseRequestBody(init) {
  return init?.body ? JSON.parse(init.body) : null;
}

describe('backend routes', () => {
  let server;
  let baseUrl;
  let fetchCalls;

  before(async () => {
    server = createServer();

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    fetchCalls = [];
    process.env.GOOGLE_PLACES_API_KEY = 'places-key';
    process.env.GOOGLE_VISION_API_KEY = 'vision-key';
    process.env.OPENAI_API_KEY = 'openai-key';
    delete process.env.TAVILY_API_KEY;
    delete process.env.OPENAI_MENU_OCR_MODEL;
    delete process.env.OPENAI_OCR_MODEL;
    delete process.env.OPENAI_MENU_MODEL;
    delete process.env.OPENAI_MENU_ENRICHMENT_MODEL;
    delete process.env.OPENAI_MENU_PARSE_MODEL;

    global.fetch = async (input, init = {}) => {
      const url = String(input);
      fetchCalls.push({
        url,
        init,
        body: parseRequestBody(init),
      });

      if (url === 'https://places.googleapis.com/v1/places:searchText') {
        return jsonResponse({
          places: [
            {
              id: 'ChIJbestmatch',
              displayName: {
                text: "Joe's Pizza",
              },
              formattedAddress: '7 Carmine St, New York, NY',
              location: {
                latitude: 40.73061,
                longitude: -73.935242,
              },
              primaryType: 'pizza_restaurant',
              types: ['pizza_restaurant', 'restaurant', 'food'],
            },
          ],
        });
      }

      if (url === 'https://places.googleapis.com/v1/places/ChIJmenuplace') {
        return jsonResponse({
          id: 'ChIJmenuplace',
          displayName: {
            text: "Joe's Pizza",
          },
          formattedAddress: '7 Carmine St, New York, NY',
          photos: [
            {
              name: 'places/ChIJmenuplace/photos/photo-1',
            },
            {
              name: 'places/ChIJmenuplace/photos/photo-2',
            },
          ],
        });
      }

      if (url.includes('/places/ChIJmenuplace/photos/photo-1/media')) {
        return jsonResponse({
          photoUri: 'https://lh3.googleusercontent.com/photo-1',
        });
      }

      if (url.includes('/places/ChIJmenuplace/photos/photo-2/media')) {
        return jsonResponse({
          photoUri: 'https://lh3.googleusercontent.com/photo-2',
        });
      }

      if (url === 'https://lh3.googleusercontent.com/photo-1' || url === 'https://lh3.googleusercontent.com/photo-2') {
        return imageResponse();
      }

      if (url.startsWith('https://vision.googleapis.com/v1/images:annotate')) {
        const photoDownloads = fetchCalls.filter((call) => call.url.startsWith('https://lh3.googleusercontent.com/')).length;

        return jsonResponse({
          responses: [
            {
              fullTextAnnotation: {
                text: photoDownloads === 1 ? 'front door hours' : 'MENU\nCheese Slice $3.50',
              },
            },
          ],
        });
      }

      if (url === 'https://api.openai.com/v1/responses') {
        const body = parseRequestBody(init);
        const isMenuExtraction = Boolean(body.text?.format);
        const formatName = body.text?.format?.name;

        if (formatName === 'menu_online_enrichment') {
          return jsonResponse({
            output_text: JSON.stringify({
              foundMenu: true,
              confidence: 0.9,
              finalText: 'MENU\nCheese Slice - classic cheese pizza slice $3.50',
              photoTextUsed: 'MENU\nCheese Slice $3.50',
              queriesRun: ["Joe's Pizza 7 Carmine St menu", "Joe's Pizza menu New York"],
              sources: [
                {
                  url: 'https://joespizzanyc.example/menu',
                  title: "Joe's Pizza Menu",
                },
              ],
              matchedPhotoItems: ['Cheese Slice'],
              filledFields: ['Cheese Slice description'],
              notes: ['Online menu matched the store name, location, and photo-visible items.'],
            }),
          });
        }

        if (formatName === 'menu_item_parse') {
          const userText = body.input[0].content[0].text;
          const enriched = userText.includes('soft knots with marinara');
          const enrichedCheese = userText.includes('classic cheese pizza slice');
          const cheeseSlice = userText.includes('Cheese Slice');

          return jsonResponse({
            output_text: JSON.stringify({
              items: enriched
                ? [
                    {
                      name: 'Original',
                      description: '',
                      price: '',
                    },
                    {
                      name: 'Coffee Jelly (topping)',
                      description: '',
                      price: '$1',
                    },
                    {
                      name: '40 g/L sugar level',
                      description: '',
                      price: '',
                    },
                    {
                      name: 'Garlic Knots',
                      description: 'soft knots with marinara',
                      price: '$6',
                    },
                    {
                      name: 'Margherita Pizza',
                      description: 'mozzarella, basil, tomato',
                      price: '$14',
                    },
                  ]
                : enrichedCheese
                  ? [
                      {
                        name: 'Original',
                        description: '',
                        price: '',
                      },
                      {
                        name: '40 g/L sugar level',
                        description: '',
                        price: '',
                      },
                      {
                        name: 'Supreme Brown Sugar Boba Milk Tea',
                        description: '',
                        price: '$7.99',
                      },
                      {
                        name: 'Cheese Slice',
                        description: 'classic cheese pizza slice',
                        price: '$3.50',
                      },
                    ]
                : cheeseSlice
                  ? [
                      {
                        name: 'Original',
                        description: '',
                        price: '',
                      },
                      {
                        name: '40 g/L sugar level',
                        description: '',
                        price: '',
                      },
                      {
                        name: 'Supreme Brown Sugar Boba Milk Tea',
                        description: '',
                        price: '$7.99',
                      },
                      {
                        name: 'Cheese Slice',
                        description: '',
                        price: '$3.50',
                      },
                    ]
                : [
                    {
                      name: 'Original',
                      description: '',
                      price: '',
                    },
                    {
                      name: 'Coffee Jelly (topping)',
                      description: '',
                      price: '$1',
                    },
                    {
                      name: '40 g/L sugar level',
                      description: '',
                      price: '',
                    },
                    {
                      name: 'Garlic Knots',
                      description: '',
                      price: '$6',
                    },
                    {
                      name: 'Margherita Pizza',
                      description: '',
                      price: '$14',
                    },
                  ],
            }),
          });
        }

        if (!isMenuExtraction) {
          const photoDownloads = fetchCalls.filter((call) => call.url.startsWith('https://lh3.googleusercontent.com/')).length;

          return jsonResponse({
            output_text: photoDownloads === 1 ? 'Open daily' : 'MENU\nCheese Slice $3.50',
          });
        }

        const userText = body.input[1].content[0].text;

        return jsonResponse({
          output_text: JSON.stringify({
            isMenu: userText.includes('Cheese Slice'),
            sourceUsed: 'combined',
            categories: userText.includes('Cheese Slice')
              ? [
                  {
                    name: 'Pizza',
                    items: [
                      {
                        name: 'Cheese Slice',
                        description: '',
                        price: '$3.50',
                      },
                    ],
                  },
                ]
              : [],
          }),
        });
      }

      throw new Error(`Unhandled mocked fetch: ${url}`);
    };
  });

  after(async () => {
    global.fetch = nativeFetch;

    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  });

  it('returns ok from GET /health', async () => {
    const response = await nativeFetch(`${baseUrl}/health`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
      status: 'ok',
      service: 'decaide-backend',
    });
  });

  it('returns 404 JSON for unknown routes', async () => {
    const response = await nativeFetch(`${baseUrl}/missing`);
    const payload = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(payload, {
      error: 'not_found',
    });
  });

  it('validates required location for place search', async () => {
    const response = await nativeFetch(`${baseUrl}/api/places/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: 'joes pizza',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, 'invalid_request');
    assert.equal(fetchCalls.length, 0);
  });

  it('searches Google Places with a text query and required location bias', async () => {
    const response = await nativeFetch(`${baseUrl}/api/places/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: '  joes pizza  ',
        latitude: 40.73061,
        longitude: -73.935242,
        radiusMeters: 2500,
      }),
    });
    const payload = await response.json();
    const [placesCall] = fetchCalls;

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
      placeId: 'ChIJbestmatch',
      name: "Joe's Pizza",
      formattedAddress: '7 Carmine St, New York, NY',
      location: {
        latitude: 40.73061,
        longitude: -73.935242,
      },
      primaryType: 'pizza_restaurant',
      types: ['pizza_restaurant', 'restaurant', 'food'],
    });
    assert.equal(placesCall.url, 'https://places.googleapis.com/v1/places:searchText');
    assert.equal(placesCall.init.headers['X-Goog-Api-Key'], 'places-key');
    assert.equal(
      placesCall.init.headers['X-Goog-FieldMask'],
      'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types',
    );
    assert.deepEqual(placesCall.body, {
      textQuery: 'joes pizza',
      pageSize: 1,
      locationBias: {
        circle: {
          center: {
            latitude: 40.73061,
            longitude: -73.935242,
          },
          radius: 2500,
        },
      },
    });
  });

  it('validates required placeId for menu extraction', async () => {
    const response = await nativeFetch(`${baseUrl}/api/places/menu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, 'invalid_request');
    assert.equal(fetchCalls.length, 0);
  });

  it('validates required image input for user menu OCR', async () => {
    const response = await nativeFetch(`${baseUrl}/api/menu/ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, 'invalid_request');
    assert.equal(fetchCalls.length, 0);
  });

  it('extracts OCR text from a user-provided menu image with Google Vision before OpenAI parsing', async () => {
    const response = await nativeFetch(`${baseUrl}/api/menu/ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        imageDataUrl: `data:image/jpeg;base64,${Buffer.from('fake-image').toString('base64')}`,
      }),
    });
    const payload = await response.json();
    const googleVisionCall = fetchCalls.find((call) => call.url.startsWith('https://vision.googleapis.com/v1/images:annotate'));
    const openAiCalls = fetchCalls.filter((call) => call.url === 'https://api.openai.com/v1/responses');

    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
      model: 'google_vision_document_text_detection',
      parseModel: 'gpt-5.4-mini',
      api: 'openai_responses',
      ocrProvider: 'google_vision',
      text: 'MENU\nCheese Slice $3.50',
      photoText: 'MENU\nCheese Slice $3.50',
      foodItems: [
        {
          name: 'Supreme Brown Sugar Boba Milk Tea',
          description: '',
          price: '$7.99',
        },
        {
          name: 'Cheese Slice',
          description: '',
          price: '$3.50',
        },
      ],
      confidence: 'medium',
      uncertainText: [],
      warnings: [],
      onlineEnrichment: {
        attempted: false,
        foundMenu: false,
        confidence: 0,
        finalText: 'MENU\nCheese Slice $3.50',
        photoTextUsed: 'MENU\nCheese Slice $3.50',
        queriesRun: [],
        sources: [],
        matchedPhotoItems: [],
        filledFields: [],
        notes: ['Online menu enrichment skipped because storeName, location, or TAVILY_API_KEY was missing.'],
      },
    });
    assert.equal(fetchCalls.length, 2);
    assert.equal(googleVisionCall.body.requests[0].features[0].type, 'DOCUMENT_TEXT_DETECTION');
    assert.equal(openAiCalls.length, 1);
    assert.equal(openAiCalls[0].init.headers.Authorization, 'Bearer openai-key');
    assert.equal(openAiCalls[0].body.model, 'gpt-5.4-mini');
    assert.equal(openAiCalls[0].body.text.format.name, 'menu_item_parse');
    assert.equal(openAiCalls[0].body.input[0].content[1].type, 'input_image');
    assert.equal(openAiCalls[0].body.input[0].content[1].detail, 'low');
    assert.match(openAiCalls[0].body.input[0].content[1].image_url, /^data:image\/jpeg;base64,/);
  });

  it('uses Tavily MCP enrichment when store name and location are provided', async () => {
    process.env.TAVILY_API_KEY = 'tvly-key';

    const response = await nativeFetch(`${baseUrl}/api/menu/ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        imageBase64: Buffer.from('fake-image').toString('base64'),
        mimeType: 'image/jpeg',
        storeName: "Joe's Pizza",
        location: '7 Carmine St, New York, NY',
      }),
    });
    const payload = await response.json();
    const openAiCalls = fetchCalls.filter((call) => call.url === 'https://api.openai.com/v1/responses');
    const enrichmentCall = openAiCalls.find((call) => call.body.text?.format?.name === 'menu_online_enrichment');

    assert.equal(response.status, 200);
    assert.equal(openAiCalls.length, 2);
    assert.equal(enrichmentCall.body.tools[0].type, 'mcp');
    assert.equal(enrichmentCall.body.tools[0].server_label, 'tavily');
    assert.match(enrichmentCall.body.tools[0].server_url, /^https:\/\/mcp\.tavily\.com\/mcp\/\?tavilyApiKey=tvly-key$/);
    assert.match(enrichmentCall.body.input[0].content[0].text, /Photo OCR:\nMENU/);
    assert.match(enrichmentCall.body.input[0].content[0].text, /Do not crawl or map websites/);
    const parseCall = openAiCalls.find((call) => call.body.text?.format?.name === 'menu_item_parse');

    assert.equal(parseCall.body.input[0].content[1].type, 'input_image');
    assert.equal(parseCall.body.input[0].content[1].detail, 'low');
    assert.deepEqual(payload.onlineEnrichment, {
      attempted: true,
      foundMenu: true,
      confidence: 0.9,
      finalText: 'MENU\nCheese Slice - classic cheese pizza slice $3.50',
      photoTextUsed: 'MENU\nCheese Slice $3.50',
      queriesRun: ["Joe's Pizza 7 Carmine St menu", "Joe's Pizza menu New York"],
      sources: [
        {
          url: 'https://joespizzanyc.example/menu',
          title: "Joe's Pizza Menu",
        },
      ],
      matchedPhotoItems: ['Cheese Slice'],
      filledFields: ['Cheese Slice description'],
      notes: ['Online menu matched the store name, location, and photo-visible items.'],
    });
    assert.equal(payload.text, 'MENU\nCheese Slice - classic cheese pizza slice $3.50');
    assert.equal(payload.photoText, 'MENU\nCheese Slice $3.50');
    assert.deepEqual(payload.foodItems, [
      {
        name: 'Supreme Brown Sugar Boba Milk Tea',
        description: '',
        price: '$7.99',
      },
      {
        name: 'Cheese Slice',
        description: 'classic cheese pizza slice',
        price: '$3.50',
      },
    ]);
    assert.equal(payload.parseModel, 'gpt-5.4-mini');
  });

  it('runs Google Vision OCR and OpenAI OCR separately before extracting a menu', async () => {
    const response = await nativeFetch(`${baseUrl}/api/places/menu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        placeId: 'ChIJmenuplace',
      }),
    });
    const payload = await response.json();
    const detailsCall = fetchCalls.find((call) => call.url === 'https://places.googleapis.com/v1/places/ChIJmenuplace');
    const googleVisionCalls = fetchCalls.filter((call) => call.url.startsWith('https://vision.googleapis.com/v1/images:annotate'));
    const openAiCalls = fetchCalls.filter((call) => call.url === 'https://api.openai.com/v1/responses');
    const photoDownloads = fetchCalls.filter((call) => call.url.startsWith('https://lh3.googleusercontent.com/'));

    assert.equal(response.status, 200);
    assert.equal(payload.menuFound, true);
    assert.equal(payload.photoIndex, 1);
    assert.equal(payload.photoName, 'places/ChIJmenuplace/photos/photo-2');
    assert.deepEqual(payload.ocr, {
      googleVision: {
        text: 'MENU\nCheese Slice $3.50',
        error: null,
      },
      openai: {
        text: 'MENU\nCheese Slice $3.50',
        error: null,
      },
    });
    assert.deepEqual(payload.menu, {
      sourceUsed: 'combined',
      categories: [
        {
          name: 'Pizza',
          items: [
            {
              name: 'Cheese Slice',
              description: '',
              price: '$3.50',
            },
          ],
        },
      ],
    });
    assert.equal(detailsCall.init.headers['X-Goog-FieldMask'], 'id,displayName,formattedAddress,photos');
    assert.equal(photoDownloads.length, 2);
    assert.equal(googleVisionCalls.length, 2);
    assert.equal(openAiCalls.length, 4);
    assert.equal(googleVisionCalls[0].body.requests[0].features[0].type, 'DOCUMENT_TEXT_DETECTION');
    assert.match(openAiCalls[0].body.input[0].content[1].image_url, /^data:image\/jpeg;base64,/);
    assert.equal(openAiCalls[1].body.text.format.name, 'menu_extraction');
  });

  it('returns per-photo OCR attempts when no menu is found', async () => {
    global.fetch = async (input, init = {}) => {
      const url = String(input);
      fetchCalls.push({
        url,
        init,
        body: parseRequestBody(init),
      });

      if (url === 'https://places.googleapis.com/v1/places/ChIJmenuplace') {
        return jsonResponse({
          id: 'ChIJmenuplace',
          displayName: {
            text: "Joe's Pizza",
          },
          photos: [
            {
              name: 'places/ChIJmenuplace/photos/photo-1',
            },
          ],
        });
      }

      if (url.includes('/places/ChIJmenuplace/photos/photo-1/media')) {
        return jsonResponse({
          photoUri: 'https://lh3.googleusercontent.com/photo-1',
        });
      }

      if (url === 'https://lh3.googleusercontent.com/photo-1') {
        return imageResponse();
      }

      if (url.startsWith('https://vision.googleapis.com/v1/images:annotate')) {
        return jsonResponse({
          responses: [
            {
              fullTextAnnotation: {
                text: 'front door hours',
              },
            },
          ],
        });
      }

      if (url === 'https://api.openai.com/v1/responses') {
        const body = parseRequestBody(init);

        if (!body.text?.format) {
          return jsonResponse({
            output_text: 'Open daily',
          });
        }

        return jsonResponse({
          output_text: JSON.stringify({
            isMenu: false,
            sourceUsed: 'combined',
            categories: [],
          }),
        });
      }

      throw new Error(`Unhandled mocked fetch: ${url}`);
    };

    const response = await nativeFetch(`${baseUrl}/api/places/menu`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        placeId: 'ChIJmenuplace',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.menuFound, false);
    assert.equal(payload.photosInspected, 1);
    assert.deepEqual(payload.attempts, [
      {
        photoIndex: 0,
        photoName: 'places/ChIJmenuplace/photos/photo-1',
        ocr: {
          googleVision: {
            text: 'front door hours',
            error: null,
          },
          openai: {
            text: 'Open daily',
            error: null,
          },
        },
      },
    ]);
    assert.equal(payload.menu, null);
  });
});
