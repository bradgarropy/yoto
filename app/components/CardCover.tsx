import {motion, useMotionValue, useSpring} from "motion/react"
import {useRef} from "react"

// Yoto card images have an intrinsic aspect ratio of 49:78 (width:height)
const CARD_ASPECT_RATIO = "aspect-[49/78]"

function CardCover({coverUrl, title}: {coverUrl?: string; title: string}) {
    const containerRef = useRef<HTMLDivElement>(null)

    // Motion values for smooth spring animations
    const x = useMotionValue(0)
    const y = useMotionValue(0)
    const scale = useMotionValue(1)

    // Spring config - damping 20 prevents overshoot that reveals the background
    const springConfig = {stiffness: 150, damping: 20}
    const springX = useSpring(x, springConfig)
    const springY = useSpring(y, springConfig)
    const springScale = useSpring(scale, springConfig)

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!containerRef.current) return

        const rect = containerRef.current.getBoundingClientRect()
        // Calculate position from -1 to 1 (center is 0)
        const mouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 2
        const mouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 2

        // Translate by a small amount (max 8px) in the opposite direction
        // This creates the effect of "looking into" the image
        x.set(mouseX * -8)
        y.set(mouseY * -8)
        scale.set(1.1)
    }

    const handleMouseLeave = () => {
        x.set(0)
        y.set(0)
        scale.set(1)
    }

    if (coverUrl) {
        return (
            <div
                ref={containerRef}
                className={`${CARD_ASPECT_RATIO} bg-muted rounded-2xl overflow-hidden shadow-md`}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
            >
                <motion.img
                    src={coverUrl}
                    alt={title}
                    className="w-full h-full object-cover"
                    style={{
                        x: springX,
                        y: springY,
                        scale: springScale,
                    }}
                />
            </div>
        )
    }

    return (
        <div
            ref={containerRef}
            className={`${CARD_ASPECT_RATIO} bg-muted rounded-2xl flex items-center justify-center shadow-md`}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
        >
            <motion.span
                className="text-4xl text-muted-foreground"
                style={{
                    x: springX,
                    y: springY,
                    scale: springScale,
                }}
            >
                ?
            </motion.span>
        </div>
    )
}

export {CARD_ASPECT_RATIO, CardCover}
