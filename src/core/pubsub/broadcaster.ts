type PublisherFn = (channel: string, message: string) => void | Promise<void>;
let publisher: PublisherFn | null = null;

export function setPublisher(fn: PublisherFn) {
  publisher = fn;
}

export async function publish(channel: string, message: string) {
  if (!publisher) {
    console.error('No publisher set - message dropped', channel, message);
    return;
  }

  try {
    await publisher(channel, message);
  } catch (err) {
    console.error('Publisher error', err);
  }
}
