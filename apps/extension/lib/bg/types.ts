/** The subset of runtime.MessageSender the background relies on. */
export interface Sender {
  url?: string;
  frameId?: number;
  tab?: { id?: number; url?: string };
}
