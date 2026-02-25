import { Elysia } from "elysia";

const app = new Elysia()
  .ws('/ws', {
    open(ws) {
      ws.subscribe('test-channel');
    },
    message(ws, message) {
      console.log('received', message);
    }
  })
  .listen(3000);

console.log(typeof app.server?.publish);
process.exit(0);
