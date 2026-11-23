<?php

namespace App\Http\Controllers\api\v1;

use App\Http\Requests\Preference\BulkDeletePreferenceRequest;
use App\Http\Requests\Preference\BulkStorePreferenceRequest;
use App\Http\Requests\Preference\BulkUpdatePreferenceRequest;
use App\Http\Requests\Preference\StorePreferencesRequest;
use App\Http\Requests\Preference\UpdatePreferenceRequest;
use App\Models\Preference;
use Illuminate\Http\UploadedFile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PreferenceController extends ApiBaseController
{
    /**
     * Display a listing of the preferences.
     */
    public function index(Request $request): JsonResponse
    {
        $query = Preference::query();

        if ($request->has('category')) {
            $query->where('category', $request->input('category'));
        }

        if ($request->has('field')) {
            $query->where('field', $request->input('field'));
        }

        // Column and direction come from a fixed list: a raw column name here was an SQL injection.
        $sortBy = $request->input('sort_by');
        if (in_array($sortBy, ['category', 'field', 'created_at', 'updated_at'], true)) {
            $query->orderBy($sortBy, strtolower((string) $request->input('sort_order')) === 'desc' ? 'desc' : 'asc');
        }

        if ($request->has('limit')) {
            $query->limit($request->input('limit'));
        }

        if ($request->has('offset')) {
            $query->offset($request->input('offset'));
        }

        if ($request->has('search')) {
            $query->where(function ($q) use ($request) {
                $q->where('category', 'LIKE', '%' . $request->input('search') . '%')
                    ->orWhere('field', 'LIKE', '%' . $request->input('search') . '%');
            });
        }

        $preferences = $query->paginate($request->input('per_page', 10));

        // Return the preferences in a JSON response
        return $this->okResponse(['preferences' => $preferences], __('Preferences fetched successfully'));
    }

    /**
     * Store a newly created preference in storage.
     */
    public function store(StorePreferencesRequest $request): JsonResponse
    {
        $value = $request->value;

        // Handle file upload if value is a file
        if ($request->hasFile('value')) {
            $file = $request->file('value');
            $value = $this->uploadFile($file, 'preferences');
        }

        // Create a new preference
        $preference = Preference::updateOrCreate(
            [
                'category' => $request->category,
                'field' => $request->field,
            ],
            [
                'value' => $value,
            ]
        );

        // Return the created preference in a JSON response
        return $this->createdResponse(['preference' => $preference], __('Preference created successfully'));
    }

    /**
     * Store multiple preferences in storage.
     */
    public function bulkStore(BulkStorePreferenceRequest $request): JsonResponse
    {
        foreach ($request->preferences as $pref) {
            $value = $pref['value'];

            // Handle file upload if value is a file
            if (isset($pref['value']) && $pref['value'] instanceof UploadedFile) {
                $file = $pref['value'];
                $value = $this->uploadFile($file, 'preferences');
            }

            // Create or update the preference
            Preference::updateOrCreate(
                [
                    'category' => $pref['category'],
                    'field' => $pref['field'],
                ],
                [
                    'value' => $value,
                ]
            );
        }

        // Return a success response
        return $this->createdResponse([], __('Preferences created successfully'));
    }

    /**
     * Display the specified preference.
     */
    public function show($category, $field): JsonResponse
    {
        // Fetch the preference by category and field
        $preference = Preference::where('category', $category)->where('field', $field)->first();

        // Check if the preference not exists
        if (! $preference) {
            return $this->notFoundResponse([], __('Preference not found'));
        }

        // Check if the preference exists
        // Return the specified preference in a JSON response
        return $this->okResponse(['preference' => $preference], __('Preference fetched successfully'));
    }

    /**
     * Update the specified preference in storage.
     *
     * @param  \App\Models\Preference  $preference
     */
    public function update(UpdatePreferenceRequest $request, $category, $field): JsonResponse
    {
        // Fetch the preference by category and field
        $preference = Preference::where('category', $category)->where('field', $field)->first();

        // Check if the preference not exists
        if (! $preference) {
            return $this->notFoundResponse([], __('Preference not found'));
        }

        $category = $request->category ?? $preference->category;
        $field = $request->field ?? $preference->field;
        $value = $request->value;

        // Handle file upload if value is a file
        if ($request->hasFile('value')) {
            // Delete old file if it exists
            if ($preference->value && $this->checkExistsFile($preference->value)) {
                $this->removeFile($preference->value);
            }

            $file = $request->file('value');
            $value = $this->uploadFile($file, 'preferences');
        }

        $preference->update(
            [
                'category' => $category,
                'field' => $field,
                'value' => $value,
            ]
        );

        // Return the updated preference in a JSON response
        return $this->okResponse(['preference' => $preference], __('Preference updated successfully'));
    }

    /**
     * Update multiple preferences in storage.
     */
    public function bulkUpdate(BulkUpdatePreferenceRequest $request): JsonResponse
    {
        foreach ($request->preferences as $pref) {
            // Fetch the preference by category and field
            $preference = Preference::where('category', $pref['category'])->where('field', $pref['field'])->first();

            if (! $preference) {
                return $this->notFoundResponse([], __('Preference not found for category: :category, field: :field', ['category' => $pref['category'], 'field' => $pref['field']]));
            }

            $value = $pref['value'];

            // Handle file upload if value is a file
            if (isset($pref['value']) && $pref['value'] instanceof UploadedFile) {
                // Delete old file if it exists
                if ($preference->value && $this->checkExistsFile($preference->value)) {
                    $this->removeFile($preference->value);
                }

                $file = $pref['value'];
                $value = $this->uploadFile($file, 'preferences');
            }

            // Update the preference
            $preference->update(['value' => $value]);
        }

        // Return a success response
        return $this->okResponse(['preference' => $preference], __('Preferences updated successfully'));
    }

    /**
     * Remove the specified preference from storage.
     *
     * @param  \App\Models\Preference  $preference
     */
    public function destroy($category, $field): JsonResponse
    {
        // Fetch the preference by category, field
        $preference = Preference::where('category', $category)->where('field', $field)->first();

        // Check if the preference not exists
        if (! $preference) {
            return $this->notFoundResponse([], __('Preference not found'));
        }

        // Delete the preference
        $preference->delete();

        // Return a success response
        return $this->okResponse([], __('Preference deleted successfully'));
    }

    /**
     * Remove multiple preferences from storage.
     */
    public function bulkDelete(BulkDeletePreferenceRequest $request): JsonResponse
    {
        foreach ($request->preferences as $pref) {
            $preference = Preference::where('category', $pref['category'])->where('field', $pref['field'])->first();

            if ($preference) {
                // Delete associated file if it exists
                if ($preference->value && $this->checkExistsFile($preference->value)) {
                    $this->removeFile($preference->getRawOriginal('value'));
                }

                $preference->delete();
            }
        }

        // Return a success response
        return $this->okResponse([], __('Preferences deleted successfully'));
    }

    /**
     * Get all preferences grouped by category
     */
    public function grouped($filter = null): JsonResponse
    {
        // Fetch all preferences and group them by category
        $preferences = Preference::get()->groupBy($filter ?? 'category');

        // Check if preferences are empty
        if ($preferences->isEmpty()) {
            return $this->notFoundResponse([], __('No preferences found'));
        }

        // If a filter is provided, apply it to the preferences
        if ($filter && ! in_array($filter, ['category', 'field'])) {
            return $this->badRequestResponse([], __('Invalid filter provided'));
        }

        // Return the grouped preferences in a JSON response
        return $this->okResponse(['preferences' => $preferences], __('Preferences fetched successfully'));
    }

    /**
     * Public show - returns just the raw value without authentication
     */
    public function showPublic($category, $field): JsonResponse
    {
        $preference = Preference::where('category', $category)
            ->where('field', $field)
            ->first();

        if (! $preference) {
            return $this->notFoundResponse([], __('Preference not found'));
        }

        return $this->okResponse(['preference' => $preference], __('Preference fetched successfully'));
    }

    /**
     * Get all preferences in a category
     */
    public function byCategory($category): JsonResponse
    {
        $preferences = Preference::where('category', $category)
            ->get();

        if ($preferences->isEmpty()) {
            return $this->notFoundResponse([], __('No preferences found for this category'));
        }

        return $this->okResponse(['preferences' => $preferences], __('Preferences fetched successfully'));
    }

    /**
     * Get specific fields from a category
     */
    public function specificFields($category, $fields): JsonResponse
    {
        $fieldsArray = explode(',', $fields);

        $preferences = Preference::where('category', $category)
            ->whereIn('field', $fieldsArray)
            ->get()
            ->mapWithKeys(function ($item) {
                return [$item['field'] => $item['value']];
            });

        if ($preferences->isEmpty()) {
            return $this->notFoundResponse([], __('No matching preferences found'));
        }

        return $this->okResponse(['preferences' => $preferences], __('Preferences fetched successfully'));
    }
}
