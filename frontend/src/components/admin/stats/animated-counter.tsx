"use client";

import { useEffect } from "react";
import { motion, useSpring, useTransform } from "framer-motion";

interface AnimatedCounterProps {
  value: number;
  formatter?: (value: number) => string;
  className?: string;
}

const defaultFormatter = (value: number) => value.toLocaleString("tr-TR");

/**
 * 0'dan (veya önceki değerden) hedef `value`'ya yumuşakça sayan sayaç.
 * `Math.round` ile ondalık titreşim engellenir; `value` değiştikçe
 * spring yeniden hedefe tetiklenir.
 */
export function AnimatedCounter({ value, formatter, className }: AnimatedCounterProps) {
  const spring = useSpring(0, { mass: 0.8, stiffness: 75, damping: 15 });
  const display = useTransform(spring, (current) => {
    const rounded = Math.round(current);
    return formatter ? formatter(rounded) : defaultFormatter(rounded);
  });

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return <motion.span className={className}>{display}</motion.span>;
}
