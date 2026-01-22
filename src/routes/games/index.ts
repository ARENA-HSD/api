import { Elysia, t } from "elysia";

export const gamesRoutes = new Elysia({ prefix: "/games" })
  .post("/", async ({ set, params, headers, cookie }) => {
      return {
        success: true
      };
    },
    {
      body: t.Object({
        quizId: t.String(),
        defaultMode: t.Optional(t.String({ enum: ["PERSONAL", "STAGE"] })),
      }),
      response: t.Object({
        success: t.Boolean(),
        data: t.Optional(t.Any()),
        message: t.Optional(t.String()),
      }),
      detail: { 
	        summary: 'BU ENDPOINTDEN EMIN DEGILIM HEPSİNİ WS ILE DE YAPABİLİRİZ BELKİ (Oyunu oluşturur pin atar redis e kaydeder ws baglanır.)', 
	        tags: ['Game Operations'] 
	  } 
    })
  .ws("/:id/ws", {
    message(ws, message) {
        ws.send(message)
    }
  });
