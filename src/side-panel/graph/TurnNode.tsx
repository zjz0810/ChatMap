import { useState, type CSSProperties, type MouseEvent } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import {
  calculateMiniMapLayout,
  renderableMiniLinks,
  type AnswerExpansion
} from "../ai/answer-expansion";
import { useI18n } from "../i18n/useI18n";
import { colorValue, type NodeColorName } from "./graph-colors";
import type { TurnNodeData } from "./graph-document.ts";
import { sanitizeSourceAnchors } from "./source-anchors.ts";

export function TurnNode({ id, data, selected }: NodeProps) {
  const { t } = useI18n();
  const nodeData = data as TurnNodeData;
  const [editingField, setEditingField] = useState<"title" | "summary" | null>(null);

  const commitEdit = (field: "title" | "summary", value: string) => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== nodeData[field].trim()) {
      nodeData.onUpdate?.(id, { [field]: trimmed });
    }
    setEditingField(null);
  };
  const stopEditorEvent = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };
  function shouldIgnoreNodeJumpContextMenu(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(
      target.closest("button, textarea, input, select, a, [contenteditable='true'], .turn-node__editor, .turn-node__mini-map, .react-flow__resize-control, .react-flow__handle")
    );
  }
  const jumpFromText = (event: MouseEvent) => {
    if (shouldIgnoreNodeJumpContextMenu(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!nodeData.turn || nodeData.isConversationRoot || nodeData.isCustomNode) return;
    nodeData.onJump?.(id);
  };

  return (
    <article
      className={`turn-node ${nodeData.isConversationRoot ? "is-root" : ""} ${
        selected ? "is-selected" : ""
      } ${nodeData.collapsed ? "is-collapsed" : ""} ${nodeData.important ? "is-important" : ""} ${
        nodeData.color ? "is-colored" : ""
      } ${nodeData.answerExpansion?.displayMode === "expanded" ? "is-expanded" : ""}`}
      onContextMenu={jumpFromText}
      style={
        {
          "--node-accent": nodeData.color ? colorValue(nodeData.color) : undefined,
          "--turn-node-title-line-clamp": nodeData.titleLineClamp ?? 2,
          "--turn-node-summary-line-clamp": nodeData.summaryLineClamp ?? 7
        } as CSSProperties
      }
    >
      <NodeResizer
        minWidth={nodeData.answerExpansion?.displayMode === "expanded" ? 520 : 240}
        minHeight={nodeData.answerExpansion?.displayMode === "expanded" ? 320 : 120}
        maxWidth={2200}
        maxHeight={3200}
        isVisible
        onResizeEnd={(_, params) =>
          nodeData.onResize?.(id, {
            width: Math.round(params.width),
            height: Math.round(params.height),
            manual: true
          })
        }
      />
      <Handle id="target-left" type="target" position={Position.Left} />
      <Handle
        id="target-right"
        type="target"
        position={Position.Right}
        className="turn-node__layout-handle"
      />
      <Handle
        id="target-top"
        type="target"
        position={Position.Top}
        className="turn-node__layout-handle"
      />
      <div className="turn-node__meta turn-node__drag-handle">
        <span>
          {nodeData.isConversationRoot
            ? t("node.conversation")
            : nodeData.isCustomNode
              ? t("node.note")
              : t("node.turn").replace("{number}", String(nodeData.turn!.turnIndex + 1))}
        </span>
      </div>
      {editingField === "title" ? (
        <textarea
          className="turn-node__editor turn-node__editor--title nodrag nopan nowheel"
          defaultValue={nodeData.title}
          onBlur={(event) => commitEdit("title", event.currentTarget.value)}
          onPointerDown={stopEditorEvent}
          onMouseDown={stopEditorEvent}
          onClick={stopEditorEvent}
          onDoubleClick={stopEditorEvent}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              commitEdit("title", event.currentTarget.value);
            }
          }}
          autoFocus
        />
      ) : (
        <h2
          style={nodeData.titleLineClamp === 0 ? { display: "none" } : undefined}
          onContextMenu={jumpFromText}
          onDoubleClick={(event) => {
            event.stopPropagation();
            setEditingField("title");
          }}
        >
          {nodeData.title}
        </h2>
      )}
      {nodeData.answerExpansion?.displayMode === "expanded" ? (
        <MiniMindMap
          expansion={nodeData.answerExpansion}
          selectedMiniNodeId={nodeData.selectedMiniNodeId}
          onSelect={(miniNodeId) => nodeData.onMiniNodeSelect?.(id, miniNodeId)}
        />
      ) : editingField === "summary" ? (
        <textarea
          className="turn-node__editor nodrag nopan nowheel"
          defaultValue={nodeData.summary}
          onBlur={(event) => commitEdit("summary", event.currentTarget.value)}
          onPointerDown={stopEditorEvent}
          onMouseDown={stopEditorEvent}
          onClick={stopEditorEvent}
          onDoubleClick={stopEditorEvent}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter" && event.ctrlKey) {
              event.preventDefault();
              commitEdit("summary", event.currentTarget.value);
            }
          }}
          autoFocus
        />
      ) : (
        <p
          style={nodeData.summaryLineClamp === 0 ? { display: "none" } : undefined}
          onContextMenu={jumpFromText}
          onDoubleClick={(event) => {
            event.stopPropagation();
            setEditingField("summary");
          }}
        >
          {nodeData.summary}
        </p>
      )}
      {(nodeData.status || (nodeData.tags && nodeData.tags.length > 0)) && !nodeData.isConversationRoot ? (
        <div className="turn-node__badges">
          {nodeData.status ? <span>{nodeData.status}</span> : null}
          {nodeData.tags?.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}
      <Handle id="source-right" type="source" position={Position.Right} />
      <Handle
        id="source-left"
        type="source"
        position={Position.Left}
        className="turn-node__layout-handle"
      />
      <Handle
        id="source-bottom"
        type="source"
        position={Position.Bottom}
        className="turn-node__layout-handle"
      />
    </article>
  );
}

function MiniMindMap({
  expansion,
  selectedMiniNodeId,
  onSelect
}: {
  expansion: AnswerExpansion;
  selectedMiniNodeId?: string;
  onSelect: (miniNodeId: string) => void;
}) {
  const layout = calculateMiniMapLayout(expansion);
  const nodeById = new Map(expansion.nodes.map((node) => [node.id, node]));
  const visibleLinks = renderableMiniLinks(expansion);
  const summaryTargets = new Set(
    visibleLinks
      .filter((link) => link.visualKind === "summary")
      .map((link) => link.target)
      .filter((targetId) => visibleLinks.filter((link) => link.visualKind === "summary" && link.target === targetId).length >= 2)
  );

  return (
    <div
      className={`turn-node__mini-map turn-node__mini-map--${expansion.layoutDirection} nodrag nopan nowheel`}
      style={{ width: layout.width, height: layout.height }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <svg className="turn-node__mini-links" aria-hidden="true" width={layout.width} height={layout.height}>
        {visibleLinks.map((link, index) => {
          const sourceLayout = layout.nodes[link.source];
          const targetLayout = layout.nodes[link.target];
          const source = nodeById.get(link.source);
          const target = nodeById.get(link.target);
          if (!sourceLayout || !targetLayout || !source || !target) return null;
          const sourceColor = colorValue(source.color as NodeColorName) ?? "var(--cm-primary)";
          const direction = expansion.layoutDirection === "left" ? -1 : 1;
          const sourceX = sourceLayout.x + (direction === 1 ? sourceLayout.width : 0);
          const targetX = targetLayout.x + (direction === 1 ? 0 : targetLayout.width);
          const sourceY = sourceLayout.y + sourceLayout.height / 2;
          const targetY = targetLayout.y + targetLayout.height / 2;
          const midX = sourceX + direction * Math.max(34, Math.abs(targetX - sourceX) / 2);
          const isSummary = link.visualKind === "summary";
          if (isSummary && summaryTargets.has(link.target)) return null;
          return (
            <path
              key={link.id ?? index}
              className={`turn-node__mini-link ${isSummary ? "is-summary" : ""}`}
              d={`M ${sourceX} ${sourceY} C ${midX} ${sourceY}, ${midX} ${targetY}, ${targetX} ${targetY}`}
              style={{ "--mini-link-color": sourceColor } as CSSProperties}
            />
          );
        })}
        {[...summaryTargets].map((targetId) => {
          const targetLayout = layout.nodes[targetId];
          const target = nodeById.get(targetId);
          if (!targetLayout || !target) return null;
          const sources = visibleLinks
            .filter((link) => link.visualKind === "summary" && link.target === targetId)
            .map((link) => layout.nodes[link.source])
            .filter(Boolean);
          if (sources.length < 2) return null;
          const minY = Math.min(...sources.map((node) => node.y));
          const maxY = Math.max(...sources.map((node) => node.y + node.height));
          if (maxY - minY > 260) return null;
          const direction = expansion.layoutDirection === "left" ? -1 : 1;
          const sourceEdge =
            direction === 1
              ? Math.max(...sources.map((node) => node.x + node.width))
              : Math.min(...sources.map((node) => node.x));
          const targetEdge = targetLayout.x + (direction === 1 ? 0 : targetLayout.width);
          const gap = Math.abs(targetEdge - sourceEdge);
          if (gap < 18) return null;
          const x = targetEdge - direction * Math.min(16, Math.max(8, gap / 2));
          const bend = 10 * direction;
          const midY = (minY + maxY) / 2;
          const branchColor = colorValue(target.color as NodeColorName) ?? "var(--cm-primary)";
          return (
            <path
              key={`summary-brace-${targetId}`}
              className="turn-node__mini-summary-brace"
              d={`M ${x - bend} ${minY} Q ${x} ${midY - 10}, ${x - bend} ${midY} Q ${x} ${midY + 10}, ${x - bend} ${maxY}`}
              style={{ "--mini-link-color": branchColor } as CSSProperties}
            />
          );
        })}
      </svg>
      {expansion.nodes.map((miniNode) => {
        const item = layout.nodes[miniNode.id];
        if (!item) return null;
        return (
          <button
            key={miniNode.id}
            type="button"
            data-mini-node-id={miniNode.id}
            className={`turn-node__mini-node ${miniNode.role === "branch" ? "is-branch" : ""} ${
              miniNode.role === "summary" ? "is-summary" : ""
            } ${miniNode.important ? "is-important" : ""} ${selectedMiniNodeId === miniNode.id ? "is-selected" : ""}`}
            title={miniNode.title}
            style={
              {
                left: item.x,
                top: item.y,
                width: item.width,
                height: item.height,
                "--node-accent": colorValue(miniNode.color as NodeColorName)
              } as CSSProperties
            }
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelect(miniNode.id);
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelect(miniNode.id);
            }}
          >
            {miniNode.title}
          </button>
        );
      })}
    </div>
  );
}
