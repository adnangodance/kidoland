import Foundation
import CoreGraphics
import ImageIO

guard let imageSource = CGImageSourceCreateWithURL(URL(fileURLWithPath: "/Users/adnangodanci/Downloads/Kido Land Logo + Brand Identity.jpg") as CFURL, nil),
      let fullImage = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else {
    print("Failed to load source image")
    exit(1)
}

func saveCrop(rect: CGRect, filename: String) {
    guard let cropped = fullImage.cropping(to: rect) else {
        print("Failed to crop \(filename)")
        return
    }
    let urls = [
        URL(fileURLWithPath: "/Users/adnangodanci/Documents/Projects/kidoland/src/assets/brand/\(filename)"),
        URL(fileURLWithPath: "/Users/adnangodanci/Documents/Projects/kidoland/public/brand/\(filename)")
    ]
    for url in urls {
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else { continue }
        CGImageDestinationAddImage(dest, cropped, nil)
        CGImageDestinationFinalize(dest)
    }
    print("Saved \(filename): \(cropped.width)x\(cropped.height)")
}

// 1. Top Logo Card & Full Logo
saveCrop(rect: CGRect(x: 88, y: 55, width: 1304, height: 970), filename: "brand-logo-card.png")
saveCrop(rect: CGRect(x: 230, y: 210, width: 1020, height: 650), filename: "brand-logo-full.png")
saveCrop(rect: CGRect(x: 230, y: 510, width: 1020, height: 350), filename: "brand-wordmark.png")

// 2. Social Media Cards & Real Photos
// Row 1 Col 2: Happy boy on yellow
saveCrop(rect: CGRect(x: 523, y: 3865, width: 424, height: 540), filename: "hero-child-boy.png")

// Row 2 Col 2: Two kids smiling doing crafts
saveCrop(rect: CGRect(x: 523, y: 4425, width: 424, height: 545), filename: "card-kids-crafts.png")
// Just the photo of the two kids
saveCrop(rect: CGRect(x: 541, y: 4505, width: 388, height: 445), filename: "photo-kids-crafts.png")

// Row 1 Col 1: Wordmark card
saveCrop(rect: CGRect(x: 88, y: 3865, width: 424, height: 540), filename: "card-wordmark.png")
// Row 1 Col 3: Green "Zhvillo imagjinaten"
saveCrop(rect: CGRect(x: 960, y: 3865, width: 430, height: 540), filename: "card-green-imagination.png")
// Row 2 Col 1: Purple "Përjeto Lumturinë"
saveCrop(rect: CGRect(x: 88, y: 4425, width: 424, height: 545), filename: "card-purple-joy.png")
// Row 2 Col 3: Blue "Bëhu mendjendritur"
saveCrop(rect: CGRect(x: 960, y: 4425, width: 430, height: 545), filename: "card-blue-bright.png")

// 3. Mascot Avatars from Brand Identity section
saveCrop(rect: CGRect(x: 88, y: 2410, width: 428, height: 560), filename: "mascot-red-happy.png")
saveCrop(rect: CGRect(x: 520, y: 2410, width: 432, height: 560), filename: "mascot-orange-wink.png")
saveCrop(rect: CGRect(x: 955, y: 2410, width: 435, height: 560), filename: "mascot-purple-calm.png")
saveCrop(rect: CGRect(x: 88, y: 2975, width: 428, height: 585), filename: "mascot-blue-love.png")
saveCrop(rect: CGRect(x: 520, y: 2975, width: 432, height: 585), filename: "mascot-green-curious.png")
saveCrop(rect: CGRect(x: 955, y: 2975, width: 435, height: 585), filename: "mascot-yellow-star.png")

print("All crops updated successfully!")
