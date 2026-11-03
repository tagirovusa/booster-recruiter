// On-device OCR of only the outer ring of a supplied avatar crop. No network.
import Foundation
import CoreGraphics
import ImageIO
import Vision

struct Observation: Codable {
    let text: String
    let confidence: Float
    let region: String
}

struct Output: Codable {
    let observations: [Observation]
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(message.utf8))
    exit(1)
}

guard CommandLine.arguments.count == 2,
      let source = CGImageSourceCreateWithURL(
        URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL, nil
      ),
      let original = CGImageSourceCreateImageAtIndex(source, 0, nil),
      original.width >= 48, original.height >= 48,
      original.width <= 4096, original.height <= 4096,
      Double(min(original.width, original.height)) /
        Double(max(original.width, original.height)) >= 0.85
else { fail("A square avatar image of at least 48 pixels is required.") }

let size = 512
let colorSpace = CGColorSpaceCreateDeviceRGB()
let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue
var pixels = [UInt8](repeating: 255, count: size * size * 4)
let rendered = pixels.withUnsafeMutableBytes { buffer -> Bool in
    guard let context = CGContext(
        data: buffer.baseAddress, width: size, height: size,
        bitsPerComponent: 8, bytesPerRow: size * 4,
        space: colorSpace, bitmapInfo: bitmapInfo
    ) else { return false }
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: size, height: size))
    context.interpolationQuality = .high
    context.draw(original, in: CGRect(x: 0, y: 0, width: size, height: size))
    return true
}
guard rendered else { fail("Could not rasterize avatar.") }

// Unwrap only r=0.64...0.99 of the avatar. Central text (for example on a
// shirt) never enters Vision. Different seams prevent a hashtag from being
// cut in two; the reverse orientation handles text around either semicircle.
let width = 1600
let height = 180
let radius = Double(size - 1) / 2
var observations: [Observation] = []
for seam in 0..<4 {
    for reverse in [false, true] {
        var strip = [UInt8](repeating: 255, count: width * height * 4)
        for y in 0..<height {
            let fraction = Double(y) / Double(height - 1)
            let r = radius * (reverse ? 0.64 + fraction * 0.35 : 0.99 - fraction * 0.35)
            for x in 0..<width {
                let angle = Double(seam) * .pi / 2 +
                    (reverse ? -1.0 : 1.0) * Double(x) / Double(width) * 2 * .pi
                let sx = max(0, min(size - 1, Int((radius + r * cos(angle)).rounded())))
                let sy = max(0, min(size - 1, Int((radius + r * sin(angle)).rounded())))
                let from = (sy * size + sx) * 4
                let to = (y * width + x) * 4
                for channel in 0..<4 { strip[to + channel] = pixels[from + channel] }
            }
        }
        guard let provider = CGDataProvider(data: Data(strip) as CFData),
              let image = CGImage(
                width: width, height: height, bitsPerComponent: 8,
                bitsPerPixel: 32, bytesPerRow: width * 4,
                space: colorSpace, bitmapInfo: CGBitmapInfo(rawValue: bitmapInfo),
                provider: provider, decode: nil, shouldInterpolate: true,
                intent: .defaultIntent
              ) else { fail("Could not unwrap avatar perimeter.") }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        request.automaticallyDetectsLanguage = false
        request.usesLanguageCorrection = false
        request.minimumTextHeight = 0.12
        do {
            try VNImageRequestHandler(cgImage: image).perform([request])
        } catch { fail("Vision could not process avatar perimeter.") }
        for result in request.results ?? [] {
            guard let candidate = result.topCandidates(1).first,
                  candidate.confidence >= 0.80,
                  candidate.string.count <= 100
            else { continue }
            if !observations.contains(where: { $0.text == candidate.string }) {
                observations.append(Observation(
                    text: candidate.string,
                    confidence: candidate.confidence,
                    region: "avatar_perimeter"
                ))
            }
        }
    }
}
guard let output = try? JSONEncoder().encode(Output(observations: Array(observations.prefix(64))))
else { fail("Could not encode OCR result.") }
FileHandle.standardOutput.write(output)
