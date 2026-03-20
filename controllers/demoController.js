const asyncHandler = require("express-async-handler");

let inMemoryDemoState = {
  profile: {
    name: "Lorem Ipsum\nRahman Lorem Ipsum",
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop",
    bio: "I am Lorem Ipsum. I design software at the messy beginning where ideas are raw, and potential is unlimited. My passion is turning that chaos into products people love, and businesses grow from.",
    title: "Meet the Real Me \u2728",
    footer: "Schooled by the World's Finest Minds \ud83c\udf93 \ud83c\udf0d"
  },
  bentoItems: [
    {
      id: "title-block",
      type: "title",
      text: "Meet the Real Me \u2728",
      layout: { x: 0, y: 0, w: 12, h: 1, minW: 2, minH: 1 }
    },
    {
      id: "big-image",
      type: "image",
      src: "https://images.unsplash.com/photo-1542831371-29b0f74f9713?w=800&h=600&fit=crop",
      layout: { x: 0, y: 1, w: 8, h: 6, minW: 1, minH: 1 }
    },
    {
      id: "text-bio",
      type: "textCard",
      text: "I come from an artistic family and transitioned from graphic design to UX design in 2021. Now, I am working toward becoming a UX data analyst in the future.",
      layout: { x: 8, y: 1, w: 4, h: 3, minW: 1, minH: 1 }
    },
    {
      id: "map",
      type: "map",
      src: "https://images.unsplash.com/photo-1524661135-423995f22d0b?w=400&h=300&fit=crop",
      location: "Dhaka, Bangladesh",
      layout: { x: 8, y: 4, w: 4, h: 3, minW: 1, minH: 1 }
    },
    {
      id: "linkedin",
      type: "linkedin",
      name: "Lorem Ipsum Lorem Ipsum",
      role: "Founding Designer",
      url: "https://linkedin.com/in/mohammad-aminur-rahman-maruf",
      layout: { x: 0, y: 7, w: 6, h: 3, minW: 1, minH: 1 }
    },
    {
      id: "email",
      type: "email",
      email: "uxdmaruf@gmail.com",
      url: "mailto:uxdmaruf@gmail.com",
      layout: { x: 6, y: 7, w: 3, h: 3, minW: 1, minH: 1 }
    },
    {
      id: "icon-lunar",
      type: "iconCard",
      src: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&h=300&fit=crop",
      layout: { x: 9, y: 7, w: 3, h: 3, minW: 1, minH: 1 }
    },
    {
      id: "green-text",
      type: "greenText",
      text: "I independently developed my skill set to take a startup from 0 to 100, and I have found many opportunities on Upwork.",
      layout: { x: 0, y: 10, w: 6, h: 3, minW: 1, minH: 1 }
    },
    {
      id: "upwork",
      type: "upwork",
      src: "https://images.unsplash.com/photo-1557683311-eac922347aa1?w=600&h=300&fit=crop",
      url: "https://www.upwork.com/freelancers/~01...",
      layout: { x: 6, y: 10, w: 6, h: 3, minW: 1, minH: 1 }
    }
  ]
};

const getDemoData = asyncHandler(async (req, res) => {
  res.status(200).json({
    status: "Success",
    data: inMemoryDemoState,
  });
});

const updateDemoData = asyncHandler(async (req, res) => {
  const { layouts, itemUpdates, deletedItems, addedItems, profile } = req.body;

  if (profile) {
    inMemoryDemoState.profile = { ...inMemoryDemoState.profile, ...profile };
  }

  if (addedItems && Array.isArray(addedItems)) {
    inMemoryDemoState.bentoItems = [...inMemoryDemoState.bentoItems, ...addedItems];
  }

  if (deletedItems && Array.isArray(deletedItems)) {
    inMemoryDemoState.bentoItems = inMemoryDemoState.bentoItems.filter(i => !deletedItems.includes(i.id));
  }

  if (layouts && Array.isArray(layouts)) {
    inMemoryDemoState.bentoItems = inMemoryDemoState.bentoItems.map((item) => {
      const updatedLayoutForIt = layouts.find(l => l.i === item.id);
      if (updatedLayoutForIt) {
        return {
          ...item,
          layout: {
            ...item.layout,
            x: updatedLayoutForIt.x,
            y: updatedLayoutForIt.y,
            w: updatedLayoutForIt.w,
            h: updatedLayoutForIt.h
          }
        };
      }
      return item;
    });
  }

  if (itemUpdates && Array.isArray(itemUpdates)) {
    inMemoryDemoState.bentoItems = inMemoryDemoState.bentoItems.map((item) => {
      const update = itemUpdates.find(u => u.id === item.id);
      if (update) {
        // Safe overwrite of ALL updated fields (url, bgColor, text, name, etc.)
        return { ...item, ...update }; 
      }
      return item;
    });
  }

  res.status(200).json({
    status: "Success",
    data: inMemoryDemoState,
  });
});

module.exports = { getDemoData, updateDemoData };
