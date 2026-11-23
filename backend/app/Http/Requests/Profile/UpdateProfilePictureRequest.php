<?php

namespace App\Http\Requests\Profile;

use App\Http\Requests\BaseFormRequest;

class UpdateProfilePictureRequest extends BaseFormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, \Illuminate\Contracts\Validation\ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'profile_picture' => 'sometimes|file|mimes:jpeg,png,jpg,gif,webp|max:5192',
        ];
    }
}
