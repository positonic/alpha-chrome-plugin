// Add to your transcriptionRouter
saveScreenshot: apiKeyMiddleware
    .input(z.object({
        sessionId: z.string(),
        screenshot: z.string(),
        timestamp: z.string()
    }))
    .mutation(async ({ ctx, input }) => {
        const { sessionId, screenshot, timestamp } = input;
        
        // Save screenshot to your database
        await ctx.db.screenshot.create({
            data: {
                sessionId,
                imageData: screenshot,
                timestamp,
                userId: ctx.userId
            }
        });
        
        return {
            success: true,
            savedAt: new Date().toISOString()
        };
    }), 