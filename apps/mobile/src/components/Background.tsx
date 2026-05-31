import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { theme } from '../theme';

/**
 * Fundo profissional em degradé escuro com halos subtis — dá profundidade às
 * vistas (login, ecrãs principais) sem precisar de imagens pesadas e mantendo
 * boa legibilidade em qualquer dispositivo.
 */
export function ScreenBackground({
  children,
  glow = true,
}: {
  children: React.ReactNode;
  glow?: boolean;
}) {
  return (
    <LinearGradient
      colors={['#0A1020', '#0E1A30', '#0B1221']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.fill}
    >
      {glow ? (
        <>
          <View style={[styles.glow, styles.glowTop]} />
          <View style={[styles.glow, styles.glowBottom]} />
        </>
      ) : null}
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  glow: { position: 'absolute', width: 320, height: 320, borderRadius: 320 },
  glowTop: { top: -120, right: -90, backgroundColor: `${theme.colors.primary}22` },
  glowBottom: { bottom: -140, left: -110, backgroundColor: '#7C3AED1A' },
});
