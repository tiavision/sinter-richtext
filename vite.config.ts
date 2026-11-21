// The library's own config, for `sinter check` over its fixture pages (fixtures/*.html), configured as
// an app's would be: the fixture pages draw the preview with sinter-markdown, a library of its own.
import { defineConfig } from 'vite';
import sinter from '@tiaforge-ui/sinter/vite';

export default defineConfig({
  plugins: [sinter({ libraries: ['@tiaforge-ui/sinter-markdown'] })],
});
