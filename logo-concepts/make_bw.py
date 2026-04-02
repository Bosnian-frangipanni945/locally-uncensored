from PIL import Image
import numpy as np

# Load original
img = Image.open("/home/hoshi/locally-uncensored/logo-concepts/concept_3_LU_monogram.jpg")
gray = img.convert("L")
gray_arr = np.array(gray)

# Purple/dark parts (the logo + border) become white, light background becomes black
threshold = 180
bw_arr = np.where(gray_arr < threshold, 255, 0).astype(np.uint8)

bw_img = Image.fromarray(bw_arr, mode="L")

# Save as high quality PNG
bw_img.save("/home/hoshi/locally-uncensored/logo-concepts/concept_3_LU_monogram_bw.png")
print(f"Done! Size: {bw_img.size}")
