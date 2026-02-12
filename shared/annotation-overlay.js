// Annotation overlay content script
// Injected into the active tab to provide a drawing canvas for screenshots

(function() {
    // Guard against double-injection
    if (window.__annotationOverlayInjected) return;
    window.__annotationOverlayInjected = true;

    let drawingEnabled = false;
    let currentTool = 'arrow'; // 'arrow' or 'freehand'
    let isDrawing = false;
    let startPoint = null;
    let currentPath = [];
    let drawingHistory = []; // Completed drawing operations for redraw

    const COLOR = '#FF0000';
    const LINE_WIDTH = 3;
    const ARROW_HEAD_LENGTH = 15;

    // Create canvas overlay
    const canvas = document.createElement('canvas');
    canvas.id = '__annotation-overlay-canvas';
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.cssText = [
        'position: fixed',
        'top: 0',
        'left: 0',
        'width: 100vw',
        'height: 100vh',
        'z-index: 2147483647',
        'pointer-events: none',
        'cursor: default',
        'background: transparent',
    ].join(';');
    document.documentElement.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = COLOR;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // --- Drawing helpers ---

    function drawArrow(context, fromX, fromY, toX, toY) {
        const angle = Math.atan2(toY - fromY, toX - fromX);

        // Draw line
        context.beginPath();
        context.moveTo(fromX, fromY);
        context.lineTo(toX, toY);
        context.stroke();

        // Draw arrowhead
        context.beginPath();
        context.moveTo(toX, toY);
        context.lineTo(
            toX - ARROW_HEAD_LENGTH * Math.cos(angle - Math.PI / 6),
            toY - ARROW_HEAD_LENGTH * Math.sin(angle - Math.PI / 6)
        );
        context.stroke();

        context.beginPath();
        context.moveTo(toX, toY);
        context.lineTo(
            toX - ARROW_HEAD_LENGTH * Math.cos(angle + Math.PI / 6),
            toY - ARROW_HEAD_LENGTH * Math.sin(angle + Math.PI / 6)
        );
        context.stroke();
    }

    function drawFreehandPath(context, points) {
        if (points.length < 2) return;
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            context.lineTo(points[i].x, points[i].y);
        }
        context.stroke();
    }

    function redraw() {
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        ctx.strokeStyle = COLOR;
        ctx.lineWidth = LINE_WIDTH;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (const op of drawingHistory) {
            if (op.type === 'arrow') {
                drawArrow(ctx, op.fromX, op.fromY, op.toX, op.toY);
            } else if (op.type === 'freehand') {
                drawFreehandPath(ctx, op.points);
            }
        }
    }

    // --- Mouse event handlers ---

    function onMouseDown(e) {
        if (!drawingEnabled) return;
        isDrawing = true;
        const x = e.clientX;
        const y = e.clientY;

        if (currentTool === 'arrow') {
            startPoint = { x, y };
        } else {
            currentPath = [{ x, y }];
        }
    }

    function onMouseMove(e) {
        if (!drawingEnabled || !isDrawing) return;
        const x = e.clientX;
        const y = e.clientY;

        if (currentTool === 'arrow' && startPoint) {
            // Preview: redraw history + current arrow
            redraw();
            drawArrow(ctx, startPoint.x, startPoint.y, x, y);
        } else if (currentTool === 'freehand') {
            currentPath.push({ x, y });
            // Draw incrementally for smooth freehand
            if (currentPath.length >= 2) {
                const prev = currentPath[currentPath.length - 2];
                ctx.beginPath();
                ctx.moveTo(prev.x, prev.y);
                ctx.lineTo(x, y);
                ctx.stroke();
            }
        }
    }

    function onMouseUp(e) {
        if (!drawingEnabled || !isDrawing) return;
        isDrawing = false;
        const x = e.clientX;
        const y = e.clientY;

        if (currentTool === 'arrow' && startPoint) {
            // Only save if the arrow has some length
            const dx = x - startPoint.x;
            const dy = y - startPoint.y;
            if (Math.sqrt(dx * dx + dy * dy) > 5) {
                drawingHistory.push({
                    type: 'arrow',
                    fromX: startPoint.x,
                    fromY: startPoint.y,
                    toX: x,
                    toY: y
                });
            }
            startPoint = null;
            redraw();
        } else if (currentTool === 'freehand' && currentPath.length > 1) {
            drawingHistory.push({
                type: 'freehand',
                points: [...currentPath]
            });
            currentPath = [];
        }
    }

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);

    // Prevent context menu when drawing
    canvas.addEventListener('contextmenu', function(e) {
        if (drawingEnabled) e.preventDefault();
    });

    // --- Resize handler ---

    window.addEventListener('resize', function() {
        const newDpr = window.devicePixelRatio || 1;
        canvas.width = window.innerWidth * newDpr;
        canvas.height = window.innerHeight * newDpr;
        ctx.scale(newDpr, newDpr);
        redraw();
    });

    // --- Message listener ---

    chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
        if (msg.type === 'annotation-toggle') {
            drawingEnabled = msg.enabled;
            canvas.style.pointerEvents = drawingEnabled ? 'auto' : 'none';
            canvas.style.cursor = drawingEnabled ? 'crosshair' : 'default';
            sendResponse({ ok: true, enabled: drawingEnabled });
        } else if (msg.type === 'annotation-clear') {
            drawingHistory = [];
            currentPath = [];
            isDrawing = false;
            startPoint = null;
            redraw();
            sendResponse({ ok: true });
        } else if (msg.type === 'annotation-set-tool') {
            currentTool = msg.tool;
            sendResponse({ ok: true, tool: currentTool });
        } else if (msg.type === 'annotation-ping') {
            sendResponse({ injected: true });
        }
        return true; // Keep message channel open for async response
    });
})();
