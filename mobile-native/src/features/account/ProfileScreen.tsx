import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { ListRow } from '../../components/ListRow';
import { LoadingState } from '../../components/LoadingState';
import { Screen } from '../../components/Screen';
import { Section } from '../../components/Section';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { ErrorText } from '../../components/ErrorText';
import { success } from '../../lib/haptics';
import { fontFamily, fontSize, spacing, typography, useTheme } from '../../theme';
import { errorMessage } from '../settings/errors';
import { Notice } from '../settings/Notice';
import { Avatar } from './Avatar';
import { useAccountProfile, useUpdateAccountProfile, useUploadAvatar } from './queries';
import { imageMimeType, initialsOf, resolveAvatarUrl } from './format';
import type { AvatarFile } from './types';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * Name, the name the assistant uses, the bio it reads, and the picture. Email and
 * password change through the Security screen, which needs a code.
 */
export function ProfileScreen() {
  const { colors } = useTheme();
  const profile = useAccountProfile();
  const update = useUpdateAccountProfile();
  const upload = useUploadAvatar();

  // null means "not typed yet": the field shows the saved value.
  const [first, setFirst] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [display, setDisplay] = useState<string | null>(null);
  const [bio, setBio] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (profile.isPending) return <LoadingState text="Loading your profile" />;
  if (profile.isError || !profile.data) {
    return <ErrorState message="Could not load your profile. Check your connection and try again." onRetry={() => void profile.refetch()} />;
  }

  const p = profile.data;
  const [serverFirst = '', ...serverRest] = p.name.split(' ');
  const serverLast = serverRest.join(' ');
  const firstValue = first ?? serverFirst;
  const lastValue = last ?? serverLast;
  const displayValue = display ?? (p.display_name ?? '');
  const bioValue = bio ?? (p.bio ?? '');
  const dirty =
    firstValue.trim() !== serverFirst.trim() ||
    lastValue.trim() !== serverLast.trim() ||
    displayValue.trim() !== (p.display_name ?? '').trim() ||
    bioValue.trim() !== (p.bio ?? '').trim();

  function clearDrafts() {
    setFirst(null);
    setLast(null);
    setDisplay(null);
    setBio(null);
  }

  function save() {
    setError(null);
    setNotice(null);
    update.mutate(
      {
        display_name: displayValue.trim(),
        bio: bioValue.trim(),
        user: { first_name: firstValue.trim(), last_name: lastValue.trim() },
      },
      {
        onSuccess: () => {
          clearDrafts();
          success();
          setNotice({ text: 'Profile updated successfully!', tone: 'success' });
        },
        onError: (err) => setError(errorMessage(err, 'Could not save your profile. Check your connection and try again.')),
      },
    );
  }

  async function changePicture() {
    setError(null);
    setNotice(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Allow access to your photos to choose a picture.');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (picked.canceled || picked.assets.length === 0) return;
    const asset = picked.assets[0];
    if (asset.fileSize && asset.fileSize > MAX_AVATAR_BYTES) {
      setError('That picture is larger than 2 MB. Choose a smaller one.');
      return;
    }
    const file: AvatarFile = {
      uri: asset.uri,
      name: asset.fileName ?? `avatar.${imageMimeType(asset.uri, asset.mimeType).split('/')[1]}`,
      type: imageMimeType(asset.uri, asset.mimeType),
    };
    upload.mutate(file, {
      onSuccess: () => {
        success();
        setNotice({ text: 'Profile picture updated', tone: 'success' });
      },
      onError: (err) => setError(errorMessage(err, 'Could not upload that image')),
    });
  }

  const avatarUri = resolveAvatarUrl(p.avatar);

  return (
    <Screen edges={['left', 'right']}>
      <Stack.Screen options={{ title: 'Profile' }} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.xxl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <Avatar uri={avatarUri} initials={initialsOf(p.name, p.email)} size={64} />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Text style={typography.bodyStrong} numberOfLines={1}>{p.name}</Text>
            <Button title="Change Photo" variant="secondary" loading={upload.isPending} disabled={upload.isPending} onPress={() => void changePicture()} />
          </View>
        </View>

        <Notice message={notice?.text} tone={notice?.tone} />

        <View style={{ gap: spacing.lg }}>
          <TextField label="First name" value={firstValue} onChangeText={setFirst} autoCapitalize="words" autoCorrect={false} textContentType="givenName" />
          <TextField label="Last name" value={lastValue} onChangeText={setLast} autoCapitalize="words" autoCorrect={false} textContentType="familyName" />
          <TextField
            label="What should the assistant call you?"
            value={displayValue}
            onChangeText={setDisplay}
            maxLength={80}
            placeholder={firstValue || 'Your name'}
            autoCorrect={false}
          />
          <View style={{ gap: spacing.xs }}>
            <TextField
              label="Bio"
              value={bioValue}
              onChangeText={setBio}
              multiline
              numberOfLines={3}
              placeholder="e.g. Backend engineer in Bengaluru. I prefer code first, then the explanation."
              style={{ minHeight: 84, textAlignVertical: 'top' }}
            />
            <Text style={[typography.caption, { color: colors.mutedText }]}>
              The assistant and your agents read this, so say what helps them help you.
            </Text>
          </View>
        </View>

        <ErrorText message={error} />

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Discard changes"
              variant="secondary"
              disabled={!dirty || update.isPending}
              onPress={() => {
                clearDrafts();
                setError(null);
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Save Changes" loading={update.isPending} disabled={!dirty || update.isPending} onPress={save} />
          </View>
        </View>

        <Section title="Email address" footer="Your email is what you sign in with. Changing it needs a code sent to the new address.">
          <ListRow title={p.email} subtitle="Change email and password" chevron onPress={() => router.push('/settings/security')} />
        </Section>

        <Text style={{ color: colors.mutedText, fontSize: fontSize.sm, fontFamily: fontFamily.regular }}>
          {`Member since ${p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—'}`}
        </Text>
      </ScrollView>
    </Screen>
  );
}
