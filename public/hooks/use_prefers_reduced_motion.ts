/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Returns true when the user's OS/browser has requested reduced motion.
 * Subscribes to runtime changes so toggling the system setting takes effect
 * without a page reload.
 */
export const usePrefersReducedMotion = (): boolean => {
  const [prefersReduced, setPrefersReduced] = useState<boolean>(window.matchMedia(QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return prefersReduced;
};
