import { useState } from 'react';
import { Linking, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { API_ORIGIN } from '../../config';
import { Button } from '../../components/Button';
import { confirm } from '../../components/confirm';
import { Icon } from '../../components/Icon';
import { ListRow } from '../../components/ListRow';
import { Section } from '../../components/Section';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { success, warning } from '../../lib/haptics';
import { fontSize, pressedOpacity, radius, spacing, useTheme } from '../../theme';
import { usePages, useWithdrawAnyPage } from '../pages/queries';
import type { PageVisibility, PublishedPage } from '../pages/types';
import { errorMessage } from './helpers';
import { AUDIENCES, DEFAULT_AUDIENCE, audienceLabel, mailtoLink, pageUrl, shareTitle } from './share';
import { sendCopy } from './download';
import { useShareFile } from './queries';
import type { Document } from './types';

interface Props {
  doc: Document;
  onClose: () => void;
  notify: (text: string, tone?: 'success' | 'danger') => void;
}

/**
 * Share a file: make a link, hand it on, or send a copy. A link is a snapshot,
 * and the sheet says so. Mirrors `components/files/ShareDialog.tsx`.
 */
export function ShareSheet({ doc, onClose, notify }: Props) {
  const { colors } = useTheme();
  const [audience, setAudience] = useState<PageVisibility>(DEFAULT_AUDIENCE);
  const [created, setCreated] = useState<PublishedPage | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const share = useShareFile();
  const withdraw = useWithdrawAnyPage();
  const mine = usePages();

  // Pages do not record which file they came from, so earlier links are matched on the file's name.
  const earlier = (mine.data?.results ?? []).filter(
    (p) => p.kind === 'file' && p.is_listed !== false && p.file_name === doc.filename && p.slug !== created?.slug,
  );

  const urlOf = (page: PublishedPage) => pageUrl(page.slug, API_ORIGIN);

  const copyLink = async (page: PublishedPage) => {
    try {
      await Clipboard.setStringAsync(urlOf(page));
      setCopied(page.slug);
      setTimeout(() => setCopied((c) => (c === page.slug ? null : c)), 1600);
    } catch {
      setFailure('Could not copy. Select the link and copy it by hand.');
    }
  };

  const create = async () => {
    setFailure(null);
    try {
      const page = await share.mutateAsync({
        documentId: doc.id,
        title: shareTitle(doc.filename),
        visibility: audience,
      });
      setCreated(page);
      success();
      await copyLink(page);
    } catch (err) {
      setFailure(errorMessage(err, 'Could not create the link. Please try again.'));
    }
  };

  const stop = async (page: PublishedPage) => {
    const ok = await confirm({
      title: 'Stop sharing?',
      message: 'The link stops opening for anyone.',
      destructiveLabel: 'Stop sharing',
    });
    if (!ok) return;
    setFailure(null);
    try {
      await withdraw.mutateAsync(page.slug);
      warning();
      if (created?.slug === page.slug) setCreated(null);
    } catch (err) {
      setFailure(errorMessage(err, 'Could not stop the link. Please try again.'));
    }
  };

  const sendFile = () => {
    // The file goes through the device's share sheet, so this sheet closes first.
    onClose();
    sendCopy(doc).catch((err: unknown) => notify(errorMessage(err, 'Could not get the file.'), 'danger'));
  };

  const action = { flex: 1 };

  return (
    <Sheet visible onClose={onClose} title={`Share “${doc.filename}”`}>
      <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.sm }}>
        {created ? (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ color: colors.success, fontSize: fontSize.md, fontWeight: '600' }}>
              {`Link ready · ${audienceLabel(created.visibility)}`}
            </Text>
            <View style={[styles.linkBox, { borderColor: colors.border, backgroundColor: colors.inputBackground }]}>
              <Text selectable numberOfLines={2} style={{ color: colors.text, fontSize: fontSize.sm }}>
                {urlOf(created)}
              </Text>
            </View>
            <View style={styles.row}>
              <View style={action}>
                <Button title={copied === created.slug ? 'Copied' : 'Copy'} onPress={() => void copyLink(created)} />
              </View>
              <View style={action}>
                <Button title="Open" variant="secondary" onPress={() => void Linking.openURL(urlOf(created))} />
              </View>
            </View>
            <View style={styles.row}>
              <View style={action}>
                <Button
                  title="Send with…"
                  variant="secondary"
                  onPress={() => void Share.share({ message: urlOf(created), url: urlOf(created) })}
                />
              </View>
              <View style={action}>
                <Button
                  title="Email"
                  variant="secondary"
                  onPress={() => void Linking.openURL(mailtoLink(doc.filename, urlOf(created)))}
                />
              </View>
            </View>
            <View style={styles.row}>
              <View style={action}>
                <Button title="Make another" variant="secondary" onPress={() => setCreated(null)} />
              </View>
              <View style={action}>
                <Button title="Stop sharing" variant="secondary" onPress={() => void stop(created)} />
              </View>
            </View>
            <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>
              The link shows the file as it is right now. If you change the file, share it again to send the new version.
            </Text>
          </View>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ color: colors.text, fontSize: fontSize.md, fontWeight: '500' }}>Who can open the link</Text>
            <Section>
              {AUDIENCES.map((option) => {
                const active = audience === option.value;
                return (
                  <ListRow
                    key={option.value}
                    title={option.label}
                    subtitle={option.detail}
                    chevron={false}
                    onPress={() => setAudience(option.value)}
                    detail={
                      <Icon
                        name={active ? 'radio-button-on' : 'radio-button-off'}
                        size={20}
                        color={active ? colors.primary : colors.mutedText}
                      />
                    }
                  />
                );
              })}
            </Section>
            <Button
              title={share.isPending ? 'Creating the link…' : 'Create link and copy it'}
              onPress={() => void create()}
              loading={share.isPending}
            />
          </View>
        )}

        <Section>
          <ListRow
            title="Send a copy instead"
            subtitle="The file itself, through your device's apps. No link is made."
            icon="paper-plane-outline"
            chevron={false}
            detail={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send file"
                onPress={sendFile}
                style={({ pressed }) => [styles.sendButton, { opacity: pressed ? pressedOpacity : 1 }]}
              >
                <Text style={{ color: colors.primary, fontSize: fontSize.md, fontWeight: '600' }}>Send file</Text>
              </Pressable>
            }
          />
        </Section>

        {earlier.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ color: colors.mutedText, fontSize: fontSize.sm }}>
              Links already made for a file with this name
            </Text>
            <Section>
              {earlier.map((page) => (
                <ListRow
                  key={page.slug}
                  title={audienceLabel(page.visibility)}
                  subtitle={`Made ${new Date(page.created_at ?? page.updated_at).toLocaleDateString()}`}
                  chevron={false}
                  detail={
                    <View style={styles.row}>
                      <Pressable accessibilityRole="button" onPress={() => void copyLink(page)} style={styles.textAction}>
                        <Text style={{ color: colors.primary, fontSize: fontSize.sm }}>
                          {copied === page.slug ? 'Copied' : 'Copy link'}
                        </Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" onPress={() => void stop(page)} style={styles.textAction}>
                        <Text style={{ color: colors.danger, fontSize: fontSize.sm }}>Stop sharing</Text>
                      </Pressable>
                    </View>
                  }
                />
              ))}
            </Section>
          </View>
        ) : null}

        {failure ? <Text style={{ color: colors.danger, fontSize: fontSize.md }}>{failure}</Text> : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  linkBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  sendButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xs },
  textAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xs },
});
