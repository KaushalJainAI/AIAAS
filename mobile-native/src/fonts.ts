import { useFonts } from 'expo-font';
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono/400Regular';
import { IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono/500Medium';
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular';
import { IBMPlexSans_500Medium } from '@expo-google-fonts/ibm-plex-sans/500Medium';
import { IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans/600SemiBold';
import { IBMPlexSans_700Bold } from '@expo-google-fonts/ibm-plex-sans/700Bold';

/**
 * The web app's fonts (IBM Plex Sans and Mono), bundled so Android, iOS and the
 * web render the same letters. Only the weights the web loads are bundled.
 *
 * Each weight is its own family: Android does not pick a weight from
 * `fontWeight` for a custom font, so a style names the family, never a weight.
 */
export const fontFamily = {
  regular: 'IBMPlexSans_400Regular',
  medium: 'IBMPlexSans_500Medium',
  semibold: 'IBMPlexSans_600SemiBold',
  bold: 'IBMPlexSans_700Bold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
} as const;

/** Load once at the root; render nothing until it returns true. */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    [fontFamily.regular]: IBMPlexSans_400Regular,
    [fontFamily.medium]: IBMPlexSans_500Medium,
    [fontFamily.semibold]: IBMPlexSans_600SemiBold,
    [fontFamily.bold]: IBMPlexSans_700Bold,
    [fontFamily.mono]: IBMPlexMono_400Regular,
    [fontFamily.monoMedium]: IBMPlexMono_500Medium,
  });
  // A font that fails to load falls back to the system font rather than
  // leaving the app on a blank screen.
  return loaded || error != null;
}
