/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useEffect, useCallback, useMemo, useState, type RefObject } from 'react';
import { useReactFlow, type Edge, type Node } from '@xyflow/react';
import type { TopologyEdgeData, TopologyNodeData } from '../utils/graph_to_react_flow';
import {
  buildAdjacency,
  findNodeInDirection as findNodeInDirectionOf,
  type ArrowDirection,
} from '../utils/graph_navigation';

const ARROW_KEYS: ArrowDirection[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

interface UseKeyboardNavigationOptions {
  nodes: Array<Node<TopologyNodeData>>;
  edges: Array<Edge<TopologyEdgeData>>;
  selectedDeviceId: string | null;
  onNodeSelect: (node: Node<TopologyNodeData>) => void;
  onClose: () => void;
  containerRef: RefObject<HTMLDivElement>;
}

interface UseKeyboardNavigationResult {
  screenReaderAnnouncement: string;
  findNodeInDirection: (
    currentNodeId: string,
    direction: ArrowDirection
  ) => Node<TopologyNodeData> | null;
}

/**
 * Hook that provides keyboard navigation for the topology canvas.
 *
 * Supports:
 * - Arrow keys: Move focus to the nearest *connected* device in that direction,
 *   falling back to the nearest device when none is linked (see graph_navigation).
 * - Enter/Space: Delegates the focused node to `onNodeSelect`, or closes the
 *   flyout if that node is already selected. Whether a node is actually
 *   selectable (e.g. unmanaged/discovered nodes) is the caller's decision —
 *   this hook only identifies which node the user acted on.
 * - Escape: Close the device flyout
 * - "+" / "-": Zoom in and out. "0": Reset the viewport to fit the whole graph.
 *
 * Also manages screen reader announcements for arrow-key focus moves, and
 * auto-pans the viewport when keyboard focus lands on an off-screen node —
 * replicating React Flow's own `autoPanOnNodeFocus`, which only fires for its
 * native focusable node wrapper (disabled here in favor of the node
 * component's own hit-target div — see topology_canvas_react_flow.tsx).
 */
export const useKeyboardNavigation = ({
  nodes,
  edges,
  selectedDeviceId,
  onNodeSelect,
  onClose,
  containerRef,
}: UseKeyboardNavigationOptions): UseKeyboardNavigationResult => {
  const [screenReaderAnnouncement, setScreenReaderAnnouncement] = useState<string>('');
  const { getViewport, getNodesBounds, setCenter, zoomIn, zoomOut, fitView } = useReactFlow();

  const adjacency = useMemo(() => buildAdjacency(edges), [edges]);

  const findNodeInDirection = useCallback(
    (currentNodeId: string, direction: ArrowDirection): Node<TopologyNodeData> | null =>
      findNodeInDirectionOf(nodes, adjacency, currentNodeId, direction),
    [nodes, adjacency]
  );

  // The keydown listener is on `document`, so the viewport shortcuts must only fire
  // while the map genuinely holds focus. Without this they would hijack "-" and "0"
  // from the date picker, the KQL bar and the device flyout.
  const isFocusWithinMap = useCallback(
    () =>
      !!containerRef.current &&
      containerRef.current.contains(document.activeElement) &&
      document.activeElement !== document.body,
    [containerRef]
  );

  /**
   * Re-centers the viewport on a node if it's completely outside the visible
   * area — replicates React Flow's own `autoPanOnNodeFocus`, computed from its
   * public API (getViewport/getNodesBounds/setCenter) since the wrapper-level
   * `onFocus` this normally rides on is disabled along with node focusability.
   */
  const panIntoViewIfNeeded = useCallback(
    (nodeId: string) => {
      const containerEl = containerRef.current;
      if (!containerEl) return;

      const { x: panX, y: panY, zoom } = getViewport();
      const { clientWidth, clientHeight } = containerEl;
      const bounds = getNodesBounds([nodeId]);

      // Visible flow-space window, derived from the pan/zoom transform.
      const visMinX = -panX / zoom;
      const visMinY = -panY / zoom;
      const visMaxX = (clientWidth - panX) / zoom;
      const visMaxY = (clientHeight - panY) / zoom;

      // Requires full visibility, not just overlap — a focused node clipped at
      // the viewport edge should still be panned fully into view.
      const isFullyVisible =
        bounds.x >= visMinX &&
        bounds.x + bounds.width <= visMaxX &&
        bounds.y >= visMinY &&
        bounds.y + bounds.height <= visMaxY;

      if (!isFullyVisible) {
        void setCenter(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
          zoom,
        });
      }
    },
    [containerRef, getViewport, getNodesBounds, setCenter]
  );

  /**
   * Runs a viewport change without losing the keyboard user's place in the graph.
   *
   * The map renders with `onlyRenderVisibleElements`, so React Flow unmounts nodes
   * that fall outside the viewport. Zooming in around the centre can push the
   * focused device off-screen, and unmounting it destroys the focused element —
   * focus silently drops to <body>, the operator loses their position, and every
   * subsequent shortcut stops working because focus is no longer inside the map.
   *
   * So: remember which device had focus, apply the change, pan that device back
   * into view, and re-focus it once React has re-mounted it.
   */
  const preservingFocusedDevice = useCallback(
    (change: () => void) => {
      const focusedId =
        document.activeElement?.closest('[data-id]')?.getAttribute('data-id') ?? null;

      change();

      if (!focusedId) return;
      panIntoViewIfNeeded(focusedId);
      // rAF so the re-render that re-mounts the node has committed to the DOM.
      window.requestAnimationFrame(() => {
        const el = document.querySelector(`[data-id="${CSS.escape(focusedId)}"] [tabindex="0"]`);
        if (el instanceof HTMLElement) el.focus();
      });
    },
    [panIntoViewIfNeeded]
  );

  // Auto-pans on any keyboard-driven node focus (Tab included, not just our
  // own arrow-key `.focus()` calls below) — matches the scope of RF's own
  // autoPanOnNodeFocus, which fires on any focus, not only arrow-key moves.
  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      // Mirrors RF's own gate: only auto-pan for keyboard-driven focus, not a
      // mouse click that happens to also focus the element.
      if (!target.matches(':focus-visible')) return;
      const nodeElement = target.closest('[data-id]');
      const nodeId = nodeElement?.getAttribute('data-id');
      if (nodeId) panIntoViewIfNeeded(nodeId);
    };
    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, [panIntoViewIfNeeded]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedDeviceId) {
        event.preventDefault();
        onClose();
        setScreenReaderAnnouncement('Flyout closed');
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        const activeElement = document.activeElement;
        const nodeElement = activeElement?.closest('[data-id]');
        if (nodeElement) {
          const nodeId = nodeElement.getAttribute('data-id');
          const focusedNode = nodes?.find((n) => n.id === nodeId);
          if (!focusedNode || !nodeId) return;

          event.preventDefault();

          if (selectedDeviceId === nodeId) {
            onClose();
          } else {
            // Delegates to the shared selection handler, which owns whether the
            // node is actually selectable (e.g. unmanaged/discovered nodes).
            onNodeSelect(focusedNode);
          }
        }
      }
      if (ARROW_KEYS.includes(event.key as ArrowDirection)) {
        const activeElement = document.activeElement;
        const currentNodeElement = activeElement?.closest('[data-id]');
        if (currentNodeElement && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
          const currentNodeId = currentNodeElement.getAttribute('data-id');
          if (!currentNodeId) return;

          const nextNode = findNodeInDirection(currentNodeId, event.key as ArrowDirection);
          if (!nextNode) return;

          event.preventDefault();

          // Node ids come from ingested SNMP data and can contain characters that
          // are significant in a selector, so escape before interpolating.
          const nextElement = document.querySelector(
            `[data-id="${CSS.escape(nextNode.id)}"] [tabindex="0"]`
          );
          if (nextElement instanceof HTMLElement) {
            nextElement.focus();
            const label = nextNode.data.label || nextNode.id;
            setScreenReaderAnnouncement(`Focused on ${label}`);
          }
        }
        return;
      }

      // Viewport shortcuts. "=" is handled alongside "+" because the unshifted key
      // is what most layouts actually produce, and Kibana users expect both.
      if (!isFocusWithinMap() || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        preservingFocusedDevice(() => zoomIn());
        setScreenReaderAnnouncement('Zoomed in');
      } else if (event.key === '-') {
        event.preventDefault();
        preservingFocusedDevice(() => zoomOut());
        setScreenReaderAnnouncement('Zoomed out');
      } else if (event.key === '0') {
        event.preventDefault();
        preservingFocusedDevice(() => void fitView());
        setScreenReaderAnnouncement('View reset to fit all devices');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    nodes,
    selectedDeviceId,
    onNodeSelect,
    onClose,
    findNodeInDirection,
    isFocusWithinMap,
    preservingFocusedDevice,
    zoomIn,
    zoomOut,
    fitView,
  ]);

  return {
    screenReaderAnnouncement,
    findNodeInDirection,
  };
};
