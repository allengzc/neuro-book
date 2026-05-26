import {computed, ref, toValue, type MaybeRefOrGetter, type Ref} from "vue";
import {useDraggable} from "@vueuse/core";

export type ResizablePanelEdge = "left" | "right" | "top" | "bottom";

type UseResizablePanelOptions = {
    /** 当前面板尺寸，由宿主组件或 store 提供。 */
    size: MaybeRefOrGetter<number>;
    /** 面板允许的最小尺寸。 */
    minSize: MaybeRefOrGetter<number>;
    /** 面板允许的最大尺寸。 */
    maxSize: MaybeRefOrGetter<number>;
    /** 拖拽手柄所在边，决定尺寸跟随指针变化的方向。 */
    edge: MaybeRefOrGetter<ResizablePanelEdge>;
    /** 是否允许拖拽；为空时默认允许。 */
    enabled?: MaybeRefOrGetter<boolean>;
    /** 尺寸变化回调，通常映射到 v-model:update。 */
    onResize: (value: number) => void;
};

/**
 * 将面板尺寸限制在允许范围内。
 */
export function clampResizablePanelSize(value: number, minSize: number, maxSize: number): number {
    const normalizedMin = Math.max(0, minSize);
    const normalizedMax = Math.max(normalizedMin, maxSize);
    return Math.max(normalizedMin, Math.min(value, normalizedMax));
}

/**
 * 统一处理边缘拖拽调整面板尺寸。
 */
export function useResizablePanel(handleRef: Ref<HTMLElement | null>, options: UseResizablePanelOptions) {
    const startSize = ref(0);
    const startPointer = ref(0);
    const axis = edgeAxis(toValue(options.edge));

    const currentSize = computed(() => {
        return clampResizablePanelSize(toValue(options.size), toValue(options.minSize), toValue(options.maxSize));
    });

    const panelStyle = computed(() => axis === "x"
        ? {width: `${currentSize.value}px`}
        : {height: `${currentSize.value}px`});

    const {isDragging} = useDraggable(handleRef, {
        axis,
        preventDefault: true,
        stopPropagation: true,
        disabled: computed(() => options.enabled !== undefined && !toValue(options.enabled)),
        onStart: (_position, event) => {
            startSize.value = currentSize.value;
            startPointer.value = pointerPosition(event, axis);
        },
        onMove: (_position, event) => {
            const nextPointer = pointerPosition(event, axis);
            const nextSize = startSize.value + (nextPointer - startPointer.value) * edgeDirection(toValue(options.edge));
            options.onResize(clampResizablePanelSize(nextSize, toValue(options.minSize), toValue(options.maxSize)));
        },
    });

    return {
        isResizing: isDragging,
        panelStyle,
    };
}

/**
 * 根据边缘方向判断拖拽轴。
 */
function edgeAxis(edge: ResizablePanelEdge): "x" | "y" {
    return edge === "left" || edge === "right" ? "x" : "y";
}

/**
 * 右边/下边拖远会变大；左边/上边拖远会变小。
 */
function edgeDirection(edge: ResizablePanelEdge): 1 | -1 {
    return edge === "right" || edge === "bottom" ? 1 : -1;
}

/**
 * 读取当前拖拽轴上的指针坐标。
 */
function pointerPosition(event: PointerEvent, axis: "x" | "y"): number {
    return axis === "x" ? event.clientX : event.clientY;
}
