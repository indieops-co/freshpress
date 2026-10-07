import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ContainerNode, NamedElement } from '../api';

interface Props {
  containers: ContainerNode[];
  namedElements: Record<string, NamedElement>;
  activeElementId: string | null;
  onSelectElement: (elementId: string) => void;
}

interface NamedTreeNode {
  element: NamedElement;
  children: NamedTreeNode[];
}

/**
 * Collapse the raw container tree down to named elements only — an unnamed structural div
 * (no suggestedType, so no NamedElement) is skipped but still walked, so its named descendants
 * surface as children of the nearest named ancestor rather than being dropped.
 */
function buildNamedTree(containers: ContainerNode[], namedElements: Record<string, NamedElement>): NamedTreeNode[] {
  const result: NamedTreeNode[] = [];
  for (const node of containers) {
    const element = node.elementId ? namedElements[node.elementId] : undefined;
    if (element) {
      result.push({ element, children: buildNamedTree(node.children, namedElements) });
    } else {
      result.push(...buildNamedTree(node.children, namedElements));
    }
  }
  return result;
}

export default function NamedElementsSidebar({ containers, namedElements, activeElementId, onSelectElement }: Props) {
  const tree = useMemo(() => buildNamedTree(containers, namedElements), [containers, namedElements]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggle(elementId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(elementId)) next.delete(elementId);
      else next.add(elementId);
      return next;
    });
  }

  function renderRow(node: NamedTreeNode, depth: number) {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.element.id);

    return (
      <div key={node.element.id}>
        <button
          type="button"
          className={`named-elements__item${node.element.id === activeElementId ? ' named-elements__item--active' : ''}`}
          style={{ paddingLeft: `${0.65 + depth * 0.9}rem` }}
          onClick={() => onSelectElement(node.element.id)}
        >
          {hasChildren ? (
            <span
              className="named-elements__toggle"
              onClick={(e) => {
                e.stopPropagation();
                toggle(node.element.id);
              }}
            >
              {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </span>
          ) : (
            <span className="named-elements__toggle named-elements__toggle--spacer" />
          )}
          <span className="named-elements__type">{node.element.type}</span>
          <span className="named-elements__id">{node.element.id}</span>
        </button>
        {hasChildren && !isCollapsed && node.children.map((child) => renderRow(child, depth + 1))}
      </div>
    );
  }

  if (tree.length === 0) {
    return <div className="named-elements__empty">No named elements yet for this page.</div>;
  }

  return <div className="named-elements">{tree.map((node) => renderRow(node, 0))}</div>;
}
