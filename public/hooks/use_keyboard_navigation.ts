/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { useEffect, useCallback, useState, type RefObject } from 'react';
import { useReactFlow, type Node } from '@xyflow/react';
import type { TopologyNodeData } from '../utils/graph_to_react_flow';

type ArrowDirection = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

// Minimum distance (in the dominant axis) a node must be from the focused node
// to be considered a candidate for arrow-key navigation.
const DIRECTION_THRESHOLD = 50;

interface UseKeyboardNavigationOptions {
  nodes: Array<Node<TopologyNodeData>>;
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
 * - Arrow keys: Spatial navigation between nodes
 * - Enter/Space: Delegates the focused node to `onNodeSelect`, or closes the
 *   flyout if that node is already selected. Whether a node is actually
 *   selectable (e.g. unmanaged/discovered nodes) is the caller's decision —
 *   this hook only identifies which node the user acted on.
 * - Escape: Close the device flyout
 *
 * Also manages screen reader announcements for arrow-key focus moves, and
 * auto-pans the viewport when keyboard focus lands on an off-screen node —
 * replicating React Flow's own `autoPanOnNodeFocus`, which only fires for its
 * native focusable node wrapper (disabled here in favor of the node
 * component's own hit-target div — see topology_canvas_react_flow.tsx).
 */
export const useKeyboardNavigation = ({
  nodes,
  selectedDeviceId,
  onNodeSelect,
  onClose,
  containerRef,
}: UseKeyboardNavigationOptions): UseKeyboardNavigationResult => {
  const [screenReaderAnnouncement, setScreenReaderAnnouncement] = useState<string>('');
  const { getViewport, getNodesBounds, setCenter } = useReactFlow();

  /**
   * Find the closest node in a given direction from the current node.
   * Uses spatial positioning and distance calculation.
   */
  const findNodeInDirection = useCallback(
    (currentNodeId: string, direction: ArrowDirection): Node<TopologyNodeData> | null => {
      const currentNode = nodes?.find((n) => n.id === currentNodeId);
      if (!currentNode) return null;

      const current = currentNode.position;
      const candidates: Array<{ node: Node<TopologyNodeData>; distance: number }> = [];

      nodes.forEach((node) => {
        if (node.id === currentNodeId) return;

        const pos = node.position;
        const dx = pos.x - current.x;
        const dy = pos.y - current.y;

        const isInDirection =
          (direction === 'ArrowRight' && dx > DIRECTION_THRESHOLD && Math.abs(dy) < Math.abs(dx)) ||
          (direction === 'ArrowLeft' && dx < -DIRECTION_THRESHOLD && Math.abs(dy) < Math.abs(dx)) ||
          (direction === 'ArrowDown' && dy > DIRECTION_THRESHOLD && Math.abs(dx) < Math.abs(dy)) ||
          (direction === 'ArrowUp' && dy < -DIRECTION_THRESHOLD && Math.abs(dx) < Math.abs(dy));

        if (isInDirection) {
          const distance = Math.sqrt(dx * dx + dy * dy);
          candidates.push({ node, distance });
        }
      });

      candidates.sort((a, b) => a.distance - b.distance);
      return candidates[0]?.node || null;
    },
    [nodes]
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
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        const activeElement = document.activeElement;
        const currentNodeElement = activeElement?.closest('[data-id]');
        if (currentNodeElement && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
          const currentNodeId = currentNodeElement.getAttribute('data-id');
          if (!currentNodeId) return;

          const nextNode = findNodeInDirection(currentNodeId, event.key as ArrowDirection);
          if (!nextNode) return;

          event.preventDefault();

          const nextElement = document.querySelector(`[data-id="${nextNode.id}"] [tabindex="0"]`);
          if (nextElement instanceof HTMLElement) {
            nextElement.focus();
            const label = nextNode.data.label || nextNode.id;
            setScreenReaderAnnouncement(`Focused on ${label}`);
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [nodes, selectedDeviceId, onNodeSelect, onClose, findNodeInDirection]);

  return {
    screenReaderAnnouncement,
    findNodeInDirection,
  };
};
