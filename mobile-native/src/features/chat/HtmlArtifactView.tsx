/**
 * A model-written HTML page, shown in a WebView the way the web shows it in a
 * sandboxed frame: no network, and no way to navigate away. The page is loaded
 * as `about:blank` with a Content-Security-Policy that refuses every request
 * (scripts and styles inline only), and the WebView only ever loads that one
 * document. Previews can be read in place or opened full screen.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { radius, spacing, typography, useTheme } from '../../theme';
import type { HtmlArtifact } from './types';

const INLINE_HEIGHT = 260;

/** Refuses every network request and any external resource; inline script and style only. */
const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:";

/** Puts the policy first in the document so it applies before anything else loads. */
export function sandboxedDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}"></head><body>${html}</body></html>`;
}

function Frame({ html, height }: { html: string; height: number }) {
  const { colors } = useTheme();
  const source = useMemo(() => ({ html: sandboxedDocument(html), baseUrl: 'about:blank' }), [html]);
  // Only the initial about:blank document may load. Anything else is refused.
  const allow = (req: WebViewNavigation) => req.url === 'about:blank' || req.url.startsWith('about:blank');
  return (
    <View style={[styles.frame, { height, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md }]}>
      <WebView
        originWhitelist={['about:blank']}
        source={source}
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={allow}
        style={{ backgroundColor: colors.surface }}
        accessibilityLabel="Preview"
      />
    </View>
  );
}

interface Props {
  artifact: HtmlArtifact;
}

/** One preview: its title, the page in place, and a button for the full-screen view. */
export function HtmlArtifactView({ artifact }: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const { height: windowHeight } = useWindowDimensions();

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text numberOfLines={1} style={[typography.label, { color: colors.text, flex: 1 }]}>
          {artifact.title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${artifact.title} full screen`}
          onPress={() => setOpen(true)}
          hitSlop={8}
          style={styles.openBtn}
        >
          <Icon name="expand-outline" size={16} color={colors.primary} />
          <Text style={[typography.label, { color: colors.primary }]}>Open</Text>
        </Pressable>
      </View>
      <Frame html={artifact.html} height={INLINE_HEIGHT} />
      <Sheet visible={open} onClose={() => setOpen(false)} title={artifact.title}>
        <Frame html={artifact.html} height={Math.round(windowHeight * 0.7)} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  openBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44, paddingHorizontal: spacing.sm },
  frame: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
});
