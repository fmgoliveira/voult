import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { shareTempFile, type ShareDeps } from './ssh-share';

const deps: ShareDeps = {
  write(name, text) {
    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.create();
    file.write(text);
    return {
      uri: file.uri,
      remove() {
        try {
          if (file.exists) file.delete();
        } catch {
          /* already gone */
        }
      },
    };
  },
  // expo-sharing serves the file through a FileProvider with a temporary read grant.
  share: (uri, mimeType, title) =>
    Sharing.shareAsync(uri, { mimeType, dialogTitle: title, UTI: 'public.text' }),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Share a private key file (e.g. to Termius) and remove it afterwards. */
export const shareKeyFile = (name: string, text: string): Promise<void> =>
  shareTempFile(deps, name, text, 'Share private key');
