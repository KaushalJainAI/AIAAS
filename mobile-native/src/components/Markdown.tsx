/**
 * A small markdown renderer for assistant replies. No library: paragraphs,
 * **bold**, *italic*, `inline code`, fenced code, headings, bullet and numbered
 * lists, and links. Links open only for http and https. A `$` is plain text.
 */
import { type ReactNode, useMemo } from 'react';
import { Linking, ScrollView, StyleSheet, View, type TextStyle } from 'react-native';
import { Text } from './Text';

import { fontSize, radius, spacing, typography, useTheme } from '../theme';

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; start: number; items: string[] };

const FENCE = /^\s*```/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*(\d+)[.)]\s+(.*)$/;

function isBreak(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || BULLET.test(line) || ORDERED.test(line);
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // the closing fence, or the end of the text
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'h', level: heading[1].length, text: heading[2].trim() });
      i += 1;
      continue;
    }
    if (BULLET.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BULLET.test(lines[i])) {
        items.push(BULLET.exec(lines[i])?.[1] ?? '');
        i += 1;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }
    const first = ORDERED.exec(line);
    if (first) {
      const start = Number(first[1]);
      const items: string[] = [];
      while (i < lines.length && ORDERED.test(lines[i])) {
        items.push(ORDERED.exec(lines[i])?.[2] ?? '');
        i += 1;
      }
      blocks.push({ kind: 'ol', start, items });
      continue;
    }
    // A paragraph runs until a blank line or the start of another block.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBreak(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: 'p', text: para.join('\n') });
  }
  return blocks;
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\*[^*\s][^*\n]*?\*)|(\[[^\]\n]+\]\([^)\s]+\))/g;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)$/;
const MAX_NESTING = 2;

function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

const MONO = typography.mono.fontFamily;

/** Splits one line of text into plain strings and styled nodes. */
/** Colours an inline run needs; the theme supplies them, so a dark or light screen both read. */
interface InlinePalette {
  link: string;
  code: string;
}

function renderInline(
  text: string,
  keyBase: string,
  palette: InlinePalette,
  depth = 0,
): ReactNode[] {
  if (depth > MAX_NESTING) return [text];
  const out: ReactNode[] = [];
  const re = new RegExp(INLINE.source, 'g');
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyBase}-${m.index}`;
    if (token.startsWith('`')) {
      out.push(
        <Text key={key} style={[styles.inlineCode, { backgroundColor: palette.code }]}>
          {token.slice(1, -1)}
        </Text>,
      );
    } else if (token.startsWith('**')) {
      out.push(
        <Text key={key} style={styles.bold}>
          {renderInline(token.slice(2, -2), key, palette, depth + 1)}
        </Text>,
      );
    } else if (token.startsWith('[')) {
      const link = LINK.exec(token);
      const label = link?.[1] ?? token;
      const url = link?.[2] ?? '';
      if (isWebUrl(url)) {
        out.push(
          <Text
            key={key}
            accessibilityRole="link"
            onPress={() => {
              Linking.openURL(url).catch(() => {
                // No handler for the URL: nothing useful to show.
              });
            }}
            style={[styles.link, { color: palette.link }]}
          >
            {label}
          </Text>,
        );
      } else {
        // Not http(s): show the words, never make it tappable.
        out.push(label);
      }
    } else {
      out.push(
        <Text key={key} style={styles.italic}>
          {renderInline(token.slice(1, -1), key, palette, depth + 1)}
        </Text>,
      );
    }
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface Props {
  text: string;
}

export function Markdown({ text }: Props) {
  const { colors } = useTheme();
  const blocks = useMemo(() => parseBlocks(text), [text]);
  const body: TextStyle = { color: colors.text, fontSize: fontSize.md, lineHeight: 22 };
  const palette: InlinePalette = { link: colors.primary, code: colors.codeBackground };

  return (
    <View style={styles.column}>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.kind) {
          case 'p':
            return (
              <Text key={key} selectable style={body}>
                {renderInline(block.text, key, palette)}
              </Text>
            );
          case 'h': {
            const size = block.level === 1 ? fontSize.xl : block.level === 2 ? fontSize.lg : fontSize.md;
            return (
              <Text key={key} selectable style={[body, styles.bold, { fontSize: size, lineHeight: size + 6 }]}>
                {renderInline(block.text, key, palette)}
              </Text>
            );
          }
          case 'code':
            return (
              <ScrollView
                key={key}
                horizontal
                showsHorizontalScrollIndicator
                style={[styles.codeBox, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}
                contentContainerStyle={styles.codePad}
              >
                <Text selectable style={{ fontFamily: MONO, fontSize: fontSize.sm, color: colors.text, lineHeight: 18 }}>
                  {block.text}
                </Text>
              </ScrollView>
            );
          case 'ul':
            return (
              <View key={key} style={styles.column}>
                {block.items.map((item, n) => (
                  <View key={`${key}-${n}`} style={styles.listRow}>
                    <Text style={[body, styles.marker]}>•</Text>
                    <Text selectable style={[body, styles.listText]}>
                      {renderInline(item, `${key}-${n}`, palette)}
                    </Text>
                  </View>
                ))}
              </View>
            );
          case 'ol':
            return (
              <View key={key} style={styles.column}>
                {block.items.map((item, n) => (
                  <View key={`${key}-${n}`} style={styles.listRow}>
                    <Text style={[body, styles.marker]}>{`${block.start + n}.`}</Text>
                    <Text selectable style={[body, styles.listText]}>
                      {renderInline(item, `${key}-${n}`, palette)}
                    </Text>
                  </View>
                ))}
              </View>
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: spacing.sm },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  link: { textDecorationLine: 'underline' },
  inlineCode: { fontFamily: MONO, fontSize: fontSize.sm },
  codeBox: { borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth },
  codePad: { padding: spacing.sm },
  listRow: { flexDirection: 'row', gap: spacing.sm, paddingLeft: spacing.xs },
  marker: { width: 18, textAlign: 'right' },
  listText: { flex: 1 },
});
