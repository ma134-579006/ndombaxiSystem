import React from 'react';
import { Image, StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { copyrightLine } from '../brand';
import { theme } from '../theme';

// Logótipo principal do sistema (Ndombaxi System).
const LOGO = require('../../assets/logo.png');

export function Logo({ size = 84 }: { size?: number }) {
  return (
    <Image
      source={LOGO}
      resizeMode="contain"
      style={[styles.logo, { width: size, height: size, borderRadius: size * 0.26 }]}
    />
  );
}

/** Assinatura/direitos de autor — presente em todo o sistema. */
export function FooterCredit({ style }: { style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.credit, style]}>{copyrightLine()}</Text>;
}

const styles = StyleSheet.create({
  logo: {
    backgroundColor: theme.colors.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 8,
  },
  credit: {
    color: theme.colors.muted,
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
});
